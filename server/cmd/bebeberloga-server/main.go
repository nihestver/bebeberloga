// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Команда bebeberloga-server — единый бинарник сервера (ARCHITECTURE.md §5.5):
//
//	bebeberloga-server serve   [--config path]   запустить сервер
//	bebeberloga-server migrate [--config path]   применить миграции БД (появится в B04)
//	bebeberloga-server admin   …                 административные команды (появится в B16)
//	bebeberloga-server version                   версия
//
// Путь к конфигу — флаг --config или переменная BB_CONFIG; без них действуют умолчания
// и переменные BB_* (server/README.md).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/nihestver/bebeberloga/server/internal/buildinfo"
)

const usage = `bebeberloga-server — сервер Bebeberloga.

Подкоманды:
  serve     запустить сервер
  migrate   применить миграции базы данных
  admin     административные команды
  version   показать версию

Флаги serve и migrate:
  --config <путь>   YAML-конфиг (или переменная BB_CONFIG)
`

// errNotImplemented — подкоманда объявлена, но ещё не реализована.
var errNotImplemented = errors.New("ещё не реализовано")

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	code := run(ctx, os.Args[1:], os.LookupEnv, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

// run разбирает подкоманду и возвращает код выхода: 0 — успех, 1 — ошибка выполнения,
// 2 — ошибка использования (неизвестная подкоманда или флаг).
func run(ctx context.Context, args []string, lookupEnv func(string) (string, bool), stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	var err error
	switch args[0] {
	case "serve":
		err = cmdServe(ctx, args[1:], lookupEnv, stdout, stderr)
	case "migrate":
		err = cmdStub("migrate", args[1:], stderr)
	case "admin":
		err = cmdStub("admin", args[1:], stderr)
	case "version":
		fmt.Fprintln(stdout, buildinfo.Version())
		return 0
	case "help", "-h", "--help":
		fmt.Fprint(stdout, usage)
		return 0
	default:
		fmt.Fprintf(stderr, "неизвестная подкоманда %q\n\n%s", args[0], usage)
		return 2
	}
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		fmt.Fprintf(stderr, "ошибка: %v\n", err)
		if errors.Is(err, errUsage) {
			return 2
		}
		return 1
	}
	return 0
}

// errUsage отмечает ошибки разбора флагов.
var errUsage = errors.New("ошибка использования")

// configFlags добавляет флаг --config, по умолчанию берущий BB_CONFIG.
func configFlags(fs *flag.FlagSet, lookupEnv func(string) (string, bool)) *string {
	def, _ := lookupEnv("BB_CONFIG")
	return fs.String("config", def, "путь к YAML-конфигу (или переменная BB_CONFIG)")
}

func parseFlags(fs *flag.FlagSet, args []string) error {
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return err
		}
		return fmt.Errorf("%w: %w", errUsage, err)
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("%w: лишние аргументы %q", errUsage, fs.Args())
	}
	return nil
}

// cmdStub — заглушка подкоманды: флаги разбираются, затем возвращается ошибка.
// B17 не вызывает migrate в compose, пока она не реализована (server/STATUS.md).
func cmdStub(name string, args []string, stderr io.Writer) error {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(stderr)
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return err
		}
		return fmt.Errorf("%w: %w", errUsage, err)
	}
	return fmt.Errorf("%s: %w", name, errNotImplemented)
}
