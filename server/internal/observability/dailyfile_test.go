// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package observability

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nihestver/bebeberloga/server/internal/config"
)

// clock — часы теста: время двигается вручную.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) add(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func newClock() *clock {
	return &clock{t: time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)}
}

// openTest открывает журнал со сроком 7 дней, как в поставке.
func openTest(t *testing.T, dir string, c *clock, maxBytes int64) *DailyFile {
	t.Helper()
	d, err := OpenDailyFile(DailyFileOptions{Dir: dir, MaxDays: 7, MaxBytes: maxBytes, Now: c.now})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}

func write(t *testing.T, d *DailyFile, s string) {
	t.Helper()
	if _, err := d.Write([]byte(s)); err != nil {
		t.Fatal(err)
	}
}

func names(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		out = append(out, e.Name())
	}
	slices.Sort(out)
	return out
}

func totalSize(t *testing.T, dir string) int64 {
	t.Helper()
	files, err := listLogFiles(dir)
	if err != nil {
		t.Fatal(err)
	}
	var sum int64
	for _, f := range files {
		sum += f.size
	}
	return sum
}

// TestDailyFileOneFilePerDay: каждый день (UTC) — свой файл, записи дня лежат в нём.
func TestDailyFileOneFilePerDay(t *testing.T) {
	t.Parallel()
	dir, c := t.TempDir(), newClock()
	d := openTest(t, dir, c, 1<<20)
	write(t, d, "день 17, первая\n")
	write(t, d, "день 17, вторая\n")
	c.add(24 * time.Hour)
	write(t, d, "день 18\n")

	want := []string{"server-2026-11-17.log", "server-2026-11-18.log"}
	if got := names(t, dir); !slices.Equal(got, want) {
		t.Fatalf("файлы %v, ожидались %v", got, want)
	}
	first, err := os.ReadFile(filepath.Join(dir, want[0]))
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != "день 17, первая\nдень 17, вторая\n" {
		t.Errorf("файл первого дня: %q", first)
	}
}

// TestDailyFileRemovesOldDays: хранятся последние семь дней; восьмой день удаляет файл первого.
func TestDailyFileRemovesOldDays(t *testing.T) {
	t.Parallel()
	dir, c := t.TempDir(), newClock()
	d := openTest(t, dir, c, 1<<20)
	for range 9 {
		write(t, d, "строка\n")
		c.add(24 * time.Hour)
	}
	// Записи были 17–25 ноября; последняя запись — 25-го, значит остаются 19–25.
	got := names(t, dir)
	if len(got) != 7 || got[0] != "server-2026-11-19.log" || got[6] != "server-2026-11-25.log" {
		t.Fatalf("после девяти дней остались %v", got)
	}
}

// TestDailyFileMaintainRemovesWithoutWrites: на простаивающем сервере старые файлы удаляет
// обслуживание, а не запись — иначе они лежали бы дольше срока.
func TestDailyFileMaintainRemovesWithoutWrites(t *testing.T) {
	t.Parallel()
	dir, c := t.TempDir(), newClock()
	d := openTest(t, dir, c, 1<<20)
	write(t, d, "строка\n")
	c.add(6 * 24 * time.Hour)
	d.Maintain()
	if got := names(t, dir); len(got) != 1 {
		t.Fatalf("на седьмой день файл ещё хранится, а осталось %v", got)
	}
	c.add(24 * time.Hour)
	d.Maintain()
	if got := names(t, dir); len(got) != 0 {
		t.Fatalf("на восьмой день файл должен быть удалён, осталось %v", got)
	}
	// Журнал после этого продолжает работать: следующая запись открывает файл нового дня.
	write(t, d, "после простоя\n")
	if got := names(t, dir); !slices.Equal(got, []string{"server-2026-11-24.log"}) {
		t.Fatalf("после записи: %v", got)
	}
}

// TestDailyFileRemovesFutureDays: файл с датой позже сегодняшней остался от времени, когда часы
// спешили; по сроку он иначе не ушёл бы до наступления своей даты, поэтому удаляется сразу.
func TestDailyFileRemovesFutureDays(t *testing.T) {
	t.Parallel()
	dir, c := t.TempDir(), newClock()
	d := openTest(t, dir, c, 1<<20)
	write(t, d, "часы верны\n")
	c.add(30 * 24 * time.Hour) // часы ушли на месяц вперёд
	write(t, d, "часы спешат\n")
	if got := names(t, dir); !slices.Equal(got, []string{"server-2026-12-17.log"}) {
		t.Fatalf("пока часы спешат: %v", got)
	}
	c.add(-30 * 24 * time.Hour) // часы исправили
	write(t, d, "часы снова верны\n")
	if got := names(t, dir); !slices.Equal(got, []string{"server-2026-11-17.log"}) {
		t.Fatalf("файл с будущей датой должен быть удалён: %v", got)
	}

	// То же без записей: обслуживание удаляет и текущий файл, если его дата в будущем.
	c.add(30 * 24 * time.Hour)
	write(t, d, "часы спешат\n")
	c.add(-30 * 24 * time.Hour)
	d.Maintain()
	if got := names(t, dir); len(got) != 0 {
		t.Fatalf("после обслуживания: %v", got)
	}
	write(t, d, "запись после обслуживания\n")
	if got := names(t, dir); !slices.Equal(got, []string{"server-2026-11-17.log"}) {
		t.Fatalf("после записи: %v", got)
	}
}

// TestDailyFileCleanupErrorKeepsWriting: старый файл удалить не удалось — запись не теряется,
// а об ошибке сообщается, и не чаще раза в минуту.
func TestDailyFileCleanupErrorKeepsWriting(t *testing.T) {
	t.Parallel()
	dir, c := t.TempDir(), newClock()
	var mu sync.Mutex
	reported := 0
	d, err := OpenDailyFile(DailyFileOptions{
		Dir: dir, MaxDays: 7, MaxBytes: 1 << 20, Now: c.now,
		OnError: func(error) {
			mu.Lock()
			defer mu.Unlock()
			reported++
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	write(t, d, "первый день\n")

	d.mu.Lock()
	d.remove = func(string) error { return errors.New("удаление запрещено") }
	d.mu.Unlock()
	for range 3 {
		c.add(8 * 24 * time.Hour) // каждый раз есть файл за пределами срока
		write(t, d, "запись\n")
	}
	var out bytes.Buffer
	if err := TailLog(dir, 0, &out); err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(out.String(), "запись\n"); got != 3 {
		t.Errorf("записей %d, ожидалось 3: %q", got, out.String())
	}
	mu.Lock()
	defer mu.Unlock()
	if reported != 3 {
		t.Errorf("сообщений об ошибке %d, ожидалось 3 (между ними больше минуты)", reported)
	}
}

// TestErrorWithoutPath: путь из ошибок файловых операций не попадает в текст.
func TestErrorWithoutPath(t *testing.T) {
	t.Parallel()
	home := filepath.Join(t.TempDir(), "home", "someone", "logs", "server-2026-11-17.log")
	_, err := os.Open(home)
	if err == nil {
		t.Fatal("ожидалась ошибка")
	}
	got := ErrorWithoutPath(err)
	if strings.Contains(got, "someone") || strings.Contains(got, string(filepath.Separator)) {
		t.Errorf("путь попал в текст ошибки: %q", got)
	}
	if !strings.HasPrefix(got, "open: ") {
		t.Errorf("текст ошибки: %q", got)
	}
	if got := ErrorWithoutPath(os.ErrClosed); got != os.ErrClosed.Error() {
		t.Errorf("закрытый файл: %q", got)
	}
	if got := ErrorWithoutPath(errors.New("/home/someone/secret")); got != "ошибка файловой операции" {
		t.Errorf("неизвестная ошибка: %q", got)
	}
}

// TestDailyFileSizeCap: суммарный размер не превышает предела — самые старые части удаляются,
// день, не уместившийся в одну часть, продолжается в следующем файле.
func TestDailyFileSizeCap(t *testing.T) {
	t.Parallel()
	dir, c := t.TempDir(), newClock()
	const maxBytes = 10_000 // часть — 1000 байт
	d := openTest(t, dir, c, maxBytes)
	line := strings.Repeat("x", 99) + "\n"
	for i := range 400 { // 40 000 байт за два дня
		if i == 200 {
			c.add(24 * time.Hour)
		}
		write(t, d, line)
		if sum := totalSize(t, dir); sum > maxBytes {
			t.Fatalf("после записи %d размер журнала %d больше предела %d", i, sum, maxBytes)
		}
	}
	got := names(t, dir)
	if len(got) < 2 {
		t.Fatalf("ожидалось несколько частей, осталось %v", got)
	}
	for _, name := range got {
		if !strings.HasPrefix(name, "server-2026-11-18.") {
			t.Errorf("от первого дня ничего не должно остаться: %v", got)
			break
		}
	}
	// Последняя запись на месте.
	var out bytes.Buffer
	if err := TailLog(dir, 1, &out); err != nil {
		t.Fatal(err)
	}
	if out.String() != line {
		t.Errorf("последняя строка: %q", out.String())
	}
}

// TestDailyFileKeepsForeignFiles: чужие файлы и каталоги в каталоге журнала не удаляются
// и в размер не входят.
func TestDailyFileKeepsForeignFiles(t *testing.T) {
	t.Parallel()
	dir, c := t.TempDir(), newClock()
	foreign := []string{"notes.txt", "server-2026-11-01.log.bak", "server-2026-13-45.log", "server-2020-01-01.1.log"}
	for _, name := range foreign {
		if err := os.WriteFile(filepath.Join(dir, name), bytes.Repeat([]byte("y"), 5000), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "server-2020-01-01.log"), 0o700); err != nil {
		t.Fatal(err)
	}
	// Старый файл журнала — удаляется.
	if err := os.WriteFile(filepath.Join(dir, "server-2026-11-01.log"), []byte("старое\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	d := openTest(t, dir, c, 2000)
	write(t, d, "строка\n")

	want := append([]string{"server-2020-01-01.log", "server-2026-11-17.log"}, foreign...)
	slices.Sort(want)
	if got := names(t, dir); !slices.Equal(got, want) {
		t.Fatalf("в каталоге %v, ожидалось %v", got, want)
	}
}

// TestDailyFileAppendsAfterRestart: после перезапуска в тот же день журнал дописывается,
// а заполненная часть не переписывается.
func TestDailyFileAppendsAfterRestart(t *testing.T) {
	t.Parallel()
	dir, c := t.TempDir(), newClock()
	d1 := openTest(t, dir, c, 1<<20)
	write(t, d1, "до перезапуска\n")
	if err := d1.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := d1.Write([]byte("после закрытия\n")); err == nil {
		t.Error("запись в закрытый журнал должна вернуть ошибку")
	}
	d2 := openTest(t, dir, c, 1<<20)
	write(t, d2, "после перезапуска\n")

	var out bytes.Buffer
	if err := TailLog(dir, 0, &out); err != nil {
		t.Fatal(err)
	}
	if out.String() != "до перезапуска\nпосле перезапуска\n" {
		t.Errorf("журнал: %q", out.String())
	}
	if got := names(t, dir); len(got) != 1 {
		t.Errorf("файлов %v, ожидался один", got)
	}
}

// TestTailLog: последние строки берутся через границы файлов, от старых к новым.
func TestTailLog(t *testing.T) {
	t.Parallel()
	dir, c := t.TempDir(), newClock()
	d := openTest(t, dir, c, 1<<20)
	write(t, d, "1\n")
	write(t, d, "2\n")
	c.add(24 * time.Hour)
	write(t, d, "3\n")
	write(t, d, "4\n")

	for n, want := range map[int]string{0: "1\n2\n3\n4\n", 1: "4\n", 3: "2\n3\n4\n", 10: "1\n2\n3\n4\n"} {
		var out bytes.Buffer
		if err := TailLog(dir, n, &out); err != nil {
			t.Fatal(err)
		}
		if out.String() != want {
			t.Errorf("tail %d: %q, ожидалось %q", n, out.String(), want)
		}
	}
	if err := TailLog(filepath.Join(dir, "нет-такого"), 1, &bytes.Buffer{}); err == nil {
		t.Error("несуществующий каталог должен дать ошибку")
	}
}

// TestDailyFileConcurrentWrites: строки одновременных записей не перемешиваются.
func TestDailyFileConcurrentWrites(t *testing.T) {
	t.Parallel()
	dir, c := t.TempDir(), newClock()
	d := openTest(t, dir, c, 1<<20)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			for range 100 {
				_, _ = d.Write([]byte("0123456789\n"))
			}
		})
	}
	wg.Wait()
	var out bytes.Buffer
	if err := TailLog(dir, 0, &out); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(out.String(), "\n"), "\n")
	if len(lines) != 800 {
		t.Fatalf("строк %d, ожидалось 800", len(lines))
	}
	for _, l := range lines {
		if l != "0123456789" {
			t.Fatalf("строка перемешана: %q", l)
		}
	}
}

// TestOpenDailyFileErrors: каталог, в который нельзя писать, — ошибка при открытии.
func TestOpenDailyFileErrors(t *testing.T) {
	t.Parallel()
	file := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	for name, opts := range map[string]DailyFileOptions{
		"каталог не задан":     {MaxDays: 7, MaxBytes: 1},
		"срок ноль":            {Dir: t.TempDir(), MaxBytes: 1},
		"размер ноль":          {Dir: t.TempDir(), MaxDays: 7},
		"каталог — это файл":   {Dir: file, MaxDays: 7, MaxBytes: 1},
		"каталог внутри файла": {Dir: filepath.Join(file, "sub"), MaxDays: 7, MaxBytes: 1},
	} {
		if d, err := OpenDailyFile(opts); err == nil {
			_ = d.Close()
			t.Errorf("%s: ожидалась ошибка", name)
		}
	}
}

// TestNewLoggerWithDir: с заданным каталогом запросы пишутся в файл, а в stdout попадает
// только строка запуска — истории запросов в журнале контейнера нет.
func TestNewLoggerWithDir(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	var stdout bytes.Buffer
	cfg := config.Default().Log
	cfg.Dir = dir
	loggers, err := NewLogger(cfg, &stdout)
	if err != nil {
		t.Fatal(err)
	}
	loggers.Startup.Info().Msg("запуск")
	loggers.Log.Info().Str("route", "/api/v1/health").Msg("http")
	if err := loggers.Close(); err != nil {
		t.Fatal(err)
	}

	if got := stdout.String(); !strings.Contains(got, "запуск") || strings.Contains(got, "/api/v1/health") {
		t.Errorf("stdout: %q", got)
	}
	var file bytes.Buffer
	if err := TailLog(dir, 0, &file); err != nil {
		t.Fatal(err)
	}
	if got := file.String(); !strings.Contains(got, "запуск") || !strings.Contains(got, "/api/v1/health") {
		t.Errorf("файл журнала: %q", got)
	}
}

// TestNewLoggerWithoutDir: без каталога всё идёт в stdout, строка запуска — один раз.
func TestNewLoggerWithoutDir(t *testing.T) {
	t.Parallel()
	var stdout bytes.Buffer
	loggers, err := NewLogger(config.Default().Log, &stdout)
	if err != nil {
		t.Fatal(err)
	}
	loggers.Startup.Info().Msg("запуск")
	loggers.Log.Info().Msg("http")
	if err := loggers.Close(); err != nil {
		t.Fatal(err)
	}
	if got := stdout.String(); strings.Count(got, "запуск") != 1 || !strings.Contains(got, "http") {
		t.Errorf("stdout: %q", got)
	}
}
