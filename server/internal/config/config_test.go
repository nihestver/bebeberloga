// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func envFrom(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := m[k]
		return v, ok
	}
}

func writeFile(t *testing.T, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoadDefaults(t *testing.T) {
	t.Parallel()
	cfg, err := Load("", envFrom(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg != Default() {
		t.Errorf("Load без файла и окружения должен вернуть Default(): %+v", cfg)
	}
}

func TestLoadPrecedence(t *testing.T) {
	t.Parallel()
	path := writeFile(t, `
http:
  addr: ":9000"
  read_timeout: 7s
log:
  level: debug
database:
  url: postgres://file:secret@db/bb
`)
	cfg, err := Load(path, envFrom(map[string]string{
		"BB_HTTP_ADDR":    ":9100",
		"BB_DATABASE_URL": "postgres://env:secret@db/bb",
		"BB_NATS_URL":     "nats://nats:4222",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTP.Addr != ":9100" {
		t.Errorf("env должен перекрывать файл: addr=%q", cfg.HTTP.Addr)
	}
	if cfg.HTTP.ReadTimeout != 7*time.Second {
		t.Errorf("файл должен перекрывать умолчание: read_timeout=%s", cfg.HTTP.ReadTimeout)
	}
	if cfg.HTTP.WriteTimeout != Default().HTTP.WriteTimeout {
		t.Errorf("незатронутое поле должно остаться умолчанием: write_timeout=%s", cfg.HTTP.WriteTimeout)
	}
	if cfg.Log.Level != "debug" {
		t.Errorf("log.level=%q", cfg.Log.Level)
	}
	if cfg.Database.URL != "postgres://env:secret@db/bb" {
		t.Errorf("database.url=%q", cfg.Database.URL)
	}
	if cfg.NATS.URL != "nats://nats:4222" {
		t.Errorf("nats.url=%q", cfg.NATS.URL)
	}
}

func TestLoadEnvDuration(t *testing.T) {
	t.Parallel()
	cfg, err := Load("", envFrom(map[string]string{"BB_HEALTH_TIMEOUT": "1500ms", "BB_HTTP_SHUTDOWN_TIMEOUT": "3s"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Health.Timeout != 1500*time.Millisecond || cfg.HTTP.ShutdownTimeout != 3*time.Second {
		t.Errorf("длительности из env: %+v", cfg)
	}
}

func TestLoadErrors(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		yaml string
		env  map[string]string
		want string
	}{
		{name: "неизвестный ключ", yaml: "http:\n  address: ':1'\n", want: "address"},
		{name: "кривая длительность в env", env: map[string]string{"BB_HTTP_READ_TIMEOUT": "скоро"}, want: "BB_HTTP_READ_TIMEOUT"},
		{name: "пустой адрес", env: map[string]string{"BB_HTTP_ADDR": ""}, want: "http.addr"},
		{name: "неизвестный уровень", env: map[string]string{"BB_LOG_LEVEL": "loud"}, want: "log.level"},
		{name: "неизвестный формат", env: map[string]string{"BB_LOG_FORMAT": "xml"}, want: "log.format"},
		{name: "нулевой таймаут", yaml: "health:\n  timeout: 0s\n", want: "health.timeout"},
		{name: "схема базы", env: map[string]string{"BB_DATABASE_URL": "mysql://x/y"}, want: "database.url"},
		{name: "схема valkey", env: map[string]string{"BB_VALKEY_URL": "http://x"}, want: "valkey.url"},
		{name: "схема nats", env: map[string]string{"BB_NATS_URL": "postgres://x"}, want: "nats.url"},
		{name: "пароль не попадает в ошибку", env: map[string]string{"BB_DATABASE_URL": "mysql://user:hunter2@x/y"}, want: "database.url"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			path := ""
			if tt.yaml != "" {
				path = writeFile(t, tt.yaml)
			}
			_, err := Load(path, envFrom(tt.env))
			if err == nil {
				t.Fatal("ожидалась ошибка")
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Errorf("ошибка %q не содержит %q", err, tt.want)
			}
			if strings.Contains(err.Error(), "hunter2") {
				t.Errorf("ошибка раскрывает пароль: %q", err)
			}
		})
	}
}

func TestLoadMissingFile(t *testing.T) {
	t.Parallel()
	if _, err := Load(filepath.Join(t.TempDir(), "нет.yaml"), envFrom(nil)); err == nil {
		t.Fatal("ожидалась ошибка о несуществующем файле")
	}
}

func TestLoadEmptyFile(t *testing.T) {
	t.Parallel()
	cfg, err := Load(writeFile(t, ""), envFrom(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg != Default() {
		t.Errorf("пустой файл должен дать умолчания: %+v", cfg)
	}
}

func TestRedacted(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		in     string
		want   string
		secret string
	}{
		{name: "пустой", in: "", want: ""},
		{name: "пароль в userinfo", in: "postgres://bb:hunter2@db:5432/bb?sslmode=disable", want: "postgres://db:5432/bb", secret: "hunter2"},
		{name: "токен NATS на месте пользователя", in: "nats://s3cr3ttoken@nats:4222", want: "nats://nats:4222", secret: "s3cr3ttoken"},
		{name: "пароль в query", in: "postgres://bb@db/bb?password=hunter2", want: "postgres://db/bb", secret: "hunter2"},
		{name: "sslpassword в query", in: "postgres://db/bb?sslpassword=hunter2&sslkey=/run/secrets/key", want: "postgres://db/bb", secret: "hunter2"},
		{name: "без userinfo", in: "redis://valkey:6379/0", want: "redis://valkey:6379/0"},
		{name: "DSN key=value", in: "host=db port=5432 dbname=bb user=bb password=hunter2 sslmode=disable", want: "host=db port=5432 dbname=bb", secret: "hunter2"},
		{name: "DSN key=value без хоста", in: "password=hunter2", want: "<dsn>", secret: "hunter2"},
		{name: "неразборчивый", in: "postgres://bb:hunter2@[::1/bb", want: "<неразборчивый URL>", secret: "hunter2"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := Redacted(tt.in)
			if got != tt.want {
				t.Errorf("Redacted(%q) = %q, want %q", tt.in, got, tt.want)
			}
			if tt.secret != "" && strings.Contains(got, tt.secret) {
				t.Errorf("Redacted(%q) раскрывает секрет: %q", tt.in, got)
			}
			if strings.Contains(got, "bb@") || strings.Contains(got, "user=") {
				t.Errorf("Redacted(%q) раскрывает имя пользователя: %q", tt.in, got)
			}
		})
	}
}

func TestDatabaseKeyValueDSNAccepted(t *testing.T) {
	t.Parallel()
	cfg, err := Load("", envFrom(map[string]string{"BB_DATABASE_URL": "host=db port=5432 dbname=bb user=bb password=x"}))
	if err != nil {
		t.Fatalf("DSN key=value должен проходить валидацию: %v", err)
	}
	if !IsKeyValueDSN(cfg.Database.URL) {
		t.Error("IsKeyValueDSN")
	}
}
