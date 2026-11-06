// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package config читает конфигурацию сервера: значения по умолчанию → YAML-файл →
// переменные окружения с префиксом `BB_` (ARCHITECTURE.md §5.5: «YAML + env»).
//
// Имя переменной строится из пути ключа YAML: `http.addr` → `BB_HTTP_ADDR`,
// `database.url` → `BB_DATABASE_URL`. Таблица — server/README.md. Неизвестные ключи
// в файле — ошибка (опечатка в конфигурации не должна молча пропадать).
package config

import (
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"reflect"
	"strconv"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"
)

// EnvPrefix — префикс переменных окружения.
const EnvPrefix = "BB_"

// Config — конфигурация сервера целиком.
type Config struct {
	HTTP     HTTP     `yaml:"http"`
	Log      Log      `yaml:"log"`
	Database Database `yaml:"database"`
	Valkey   Valkey   `yaml:"valkey"`
	NATS     NATS     `yaml:"nats"`
	Health   Health   `yaml:"health"`
}

// HTTP — слушающий адрес и таймауты http.Server.
type HTTP struct {
	Addr              string        `yaml:"addr"`
	ReadHeaderTimeout time.Duration `yaml:"read_header_timeout"`
	ReadTimeout       time.Duration `yaml:"read_timeout"`
	WriteTimeout      time.Duration `yaml:"write_timeout"`
	IdleTimeout       time.Duration `yaml:"idle_timeout"`
	ShutdownTimeout   time.Duration `yaml:"shutdown_timeout"`
}

// Log — журнал.
type Log struct {
	// Level: trace, debug, info, warn, error.
	Level string `yaml:"level"`
	// Format: json (по умолчанию) или console.
	Format string `yaml:"format"`
}

// Database — PostgreSQL. Пустой URL — не настроена (в части 0 допустимо).
type Database struct {
	URL string `yaml:"url"`
}

// Valkey — Valkey. Пустой URL — не настроен.
type Valkey struct {
	URL string `yaml:"url"`
}

// NATS — NATS. Пустой URL — не настроен.
type NATS struct {
	URL string `yaml:"url"`
}

// Health — проверка зависимостей для `GET /health`.
type Health struct {
	// Timeout — общее время на все проверки.
	Timeout time.Duration `yaml:"timeout"`
	// CacheTTL — срок, в течение которого результат отдаётся без новой проверки.
	CacheTTL time.Duration `yaml:"cache_ttl"`
}

// Default — значения по умолчанию.
func Default() Config {
	return Config{
		HTTP: HTTP{
			Addr:              ":8080",
			ReadHeaderTimeout: 5 * time.Second,
			ReadTimeout:       30 * time.Second,
			WriteTimeout:      30 * time.Second,
			IdleTimeout:       2 * time.Minute,
			ShutdownTimeout:   10 * time.Second,
		},
		Log: Log{Level: "info", Format: "json"},
		Health: Health{
			Timeout:  2 * time.Second,
			CacheTTL: 2 * time.Second,
		},
	}
}

// Load читает конфигурацию: умолчания, затем файл (если путь не пустой), затем окружение.
// lookupEnv — обычно os.LookupEnv; в тестах подменяется.
func Load(path string, lookupEnv func(string) (string, bool)) (Config, error) {
	cfg := Default()
	if path != "" {
		f, err := os.Open(path) //nolint:gosec // путь задаёт оператор флагом --config или BB_CONFIG
		if err != nil {
			return Config{}, fmt.Errorf("конфиг %s: %w", path, err)
		}
		defer f.Close() //nolint:errcheck // чтение; ошибка закрытия ничего не меняет
		if err := readYAML(f, &cfg); err != nil {
			return Config{}, fmt.Errorf("конфиг %s: %w", path, err)
		}
	}
	if err := applyEnv(&cfg, lookupEnv); err != nil {
		return Config{}, err
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// readYAML разбирает YAML поверх уже заполненной структуры; неизвестные ключи — ошибка.
func readYAML(r io.Reader, cfg *Config) error {
	dec := yaml.NewDecoder(r)
	dec.KnownFields(true)
	if err := dec.Decode(cfg); err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

// applyEnv обходит поля структуры по тегам yaml и подставляет значения переменных
// `BB_<ПУТЬ>`. Поддерживаются string, bool, целые и time.Duration.
func applyEnv(cfg *Config, lookupEnv func(string) (string, bool)) error {
	return walk(reflect.ValueOf(cfg).Elem(), EnvPrefix, lookupEnv)
}

func walk(v reflect.Value, prefix string, lookupEnv func(string) (string, bool)) error {
	t := v.Type()
	for i := range t.NumField() {
		field := t.Field(i)
		tag, _, _ := strings.Cut(field.Tag.Get("yaml"), ",")
		if tag == "" || tag == "-" || !field.IsExported() {
			continue
		}
		name := prefix + strings.ToUpper(tag)
		fv := v.Field(i)
		if fv.Kind() == reflect.Struct && fv.Type() != reflect.TypeOf(time.Duration(0)) {
			if err := walk(fv, name+"_", lookupEnv); err != nil {
				return err
			}
			continue
		}
		raw, ok := lookupEnv(name)
		if !ok {
			continue
		}
		if err := setFromString(fv, raw); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	return nil
}

func setFromString(fv reflect.Value, raw string) error {
	if fv.Type() == reflect.TypeOf(time.Duration(0)) {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return fmt.Errorf("ожидается длительность вида 5s или 2m: %w", err)
		}
		fv.SetInt(int64(d))
		return nil
	}
	switch fv.Kind() {
	case reflect.String:
		fv.SetString(raw)
	case reflect.Bool:
		b, err := strconv.ParseBool(raw)
		if err != nil {
			return fmt.Errorf("ожидается true или false: %w", err)
		}
		fv.SetBool(b)
	case reflect.Int, reflect.Int64:
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return fmt.Errorf("ожидается целое число: %w", err)
		}
		fv.SetInt(n)
	default:
		return fmt.Errorf("тип %s не поддерживается переменными окружения", fv.Type())
	}
	return nil
}

// Validate проверяет согласованность значений. Ошибки собираются все сразу.
func (c Config) Validate() error {
	var errs []error
	if c.HTTP.Addr == "" {
		errs = append(errs, errors.New("http.addr: пустой адрес"))
	}
	for name, d := range map[string]time.Duration{
		"http.read_header_timeout": c.HTTP.ReadHeaderTimeout,
		"http.read_timeout":        c.HTTP.ReadTimeout,
		"http.write_timeout":       c.HTTP.WriteTimeout,
		"http.idle_timeout":        c.HTTP.IdleTimeout,
		"http.shutdown_timeout":    c.HTTP.ShutdownTimeout,
		"health.timeout":           c.Health.Timeout,
		"health.cache_ttl":         c.Health.CacheTTL,
	} {
		if d <= 0 {
			errs = append(errs, fmt.Errorf("%s: должен быть больше нуля", name))
		}
	}
	switch c.Log.Level {
	case "trace", "debug", "info", "warn", "error":
	default:
		errs = append(errs, fmt.Errorf("log.level: %q, ожидается trace, debug, info, warn или error", c.Log.Level))
	}
	switch c.Log.Format {
	case "json", "console":
	default:
		errs = append(errs, fmt.Errorf("log.format: %q, ожидается json или console", c.Log.Format))
	}
	errs = append(errs,
		checkDatabaseURL(c.Database.URL),
		checkURL("valkey.url", c.Valkey.URL, "redis", "rediss", "valkey", "valkeys"),
		checkURL("nats.url", c.NATS.URL, "nats", "tls", "ws", "wss"),
	)
	return errors.Join(errs...)
}

// checkDatabaseURL принимает URL `postgres://…` или DSN в форме `key=value` (pgx понимает обе).
func checkDatabaseURL(raw string) error {
	if raw != "" && IsKeyValueDSN(raw) {
		return nil
	}
	return checkURL("database.url", raw, "postgres", "postgresql")
}

// checkURL принимает пустую строку («не настроено») или URL с одной из схем.
// В сообщении об ошибке адрес не приводится: в нём могут быть учётные данные.
func checkURL(name, raw string, schemes ...string) error {
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("%s: не разбирается как URL", name)
	}
	for _, s := range schemes {
		if u.Scheme == s {
			return nil
		}
	}
	return fmt.Errorf("%s: схема %q, ожидается одна из %s", name, u.Scheme, strings.Join(schemes, ", "))
}

// IsKeyValueDSN — строка вида `host=db port=5432 dbname=bb`, без `://`.
func IsKeyValueDSN(raw string) bool {
	return !strings.Contains(raw, "://") && strings.Contains(raw, "=")
}

// Redacted возвращает адрес для журнала: только схема, хост, порт и путь (имя базы).
// Userinfo и query убираются целиком — в них живут пароли, токены и пути к ключам,
// и перечислять «чувствительные» параметры поимённо ненадёжно. Для DSN `key=value`
// остаются только host, port и dbname.
func Redacted(raw string) string {
	if raw == "" {
		return ""
	}
	if IsKeyValueDSN(raw) {
		return redactKeyValue(raw)
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" {
		return "<неразборчивый URL>"
	}
	out := u.Scheme + "://" + u.Host
	if u.Path != "" {
		out += u.Path
	}
	return out
}

// redactKeyValue оставляет из DSN `key=value` только host, port и dbname в исходном порядке.
func redactKeyValue(raw string) string {
	var kept []string
	for _, field := range strings.Fields(raw) {
		key, _, ok := strings.Cut(field, "=")
		if !ok {
			continue
		}
		switch strings.ToLower(key) {
		case "host", "port", "dbname":
			kept = append(kept, field)
		}
	}
	if len(kept) == 0 {
		return "<dsn>"
	}
	return strings.Join(kept, " ")
}
