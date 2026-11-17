// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package observability

import (
	"bufio"
	"cmp"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"sync"
	"syscall"
	"time"
)

// Журнал сервера хранится 7 суток или 50 МБ, что наступит раньше (RETENTION.md §6,
// ответ владельца на OPEN-QUESTIONS №53): по псевдонимам он показывает, когда был активен
// один и тот же пользователь, поэтому дольше не лежит. Срок и размер — в config.Log.
const (
	// logParts — на сколько частей делится предел размера: день, не уместившийся в одну часть,
	// продолжается в следующем файле, и старое удаляется частями, а не целым днём.
	logParts = 10

	logFilePrefix = "server-"
	logFileSuffix = ".log"
	logDayLayout  = "2006-01-02"

	// logMaintainInterval — как часто журнал без записей проверяет, не пора ли удалить старые файлы.
	logMaintainInterval = time.Hour
	// logErrorInterval — не чаще чем раз в столько сообщается об ошибке записи журнала.
	logErrorInterval = time.Minute
)

// logFileName разбирает имя файла журнала: `server-2026-11-17.log` — первая часть дня,
// `server-2026-11-17.2.log` — вторая и так далее.
var logFileName = regexp.MustCompile(`^server-(\d{4}-\d{2}-\d{2})(?:\.(\d{1,9}))?\.log$`)

// DailyFileOptions — параметры журнала в файлах по дням.
type DailyFileOptions struct {
	// Dir — каталог журнала; создаётся, если его нет.
	Dir string
	// MaxDays — сколько календарных дней хранить, считая сегодняшний.
	MaxDays int
	// MaxBytes — предел суммарного размера файлов.
	MaxBytes int64
	// Now — часы; nil — time.Now.
	Now func() time.Time
	// OnError получает ошибки записи и очистки самого журнала, не чаще раза в минуту; nil — никуда.
	// Вызывается под блокировкой журнала: писать из него в этот же журнал нельзя.
	OnError func(error)
}

// DailyFile пишет журнал в файл на каждый день (UTC) и удаляет старое: файлы дней за пределами
// MaxDays и самые старые части, пока суммарный размер больше MaxBytes. Чужие файлы в каталоге
// не трогает. Безопасен для одновременной записи; одна запись — один вызов Write.
type DailyFile struct {
	dir       string
	maxDays   int
	maxBytes  int64
	partBytes int64
	now       func() time.Time
	onError   func(error)
	remove    func(string) error // os.Remove; подменяется в тестах

	mu      sync.Mutex
	f       *os.File
	day     string
	part    int
	size    int64
	closed  bool
	lastErr time.Time

	stop chan struct{}
	done chan struct{}
}

type logFile struct {
	name string
	day  string
	part int
	size int64
}

// OpenDailyFile открывает журнал в каталоге: создаёт каталог, удаляет старое и открывает файл
// текущего дня. Ошибка — каталог недоступен для записи; сервер с ней не стартует.
func OpenDailyFile(opts DailyFileOptions) (*DailyFile, error) {
	if opts.Dir == "" {
		return nil, errors.New("журнал: каталог не задан")
	}
	if opts.MaxDays < 1 || opts.MaxBytes < 1 {
		return nil, errors.New("журнал: срок и размер должны быть больше нуля")
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	d := &DailyFile{
		dir:       opts.Dir,
		maxDays:   opts.MaxDays,
		maxBytes:  opts.MaxBytes,
		partBytes: max(opts.MaxBytes/logParts, 1),
		now:       now,
		onError:   opts.OnError,
		remove:    os.Remove,
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
	// В тексте ошибки нет пути: каталог журнала может лежать в домашнем каталоге, а эта ошибка
	// попадает в stderr и журнал службы (ADR-0025).
	if err := os.MkdirAll(d.dir, 0o700); err != nil {
		return nil, fmt.Errorf("журнал: каталог log.dir недоступен: %s", ErrorWithoutPath(err))
	}
	d.mu.Lock()
	err := d.rotateLocked(d.today(), false)
	d.mu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("журнал: каталог log.dir недоступен: %s", ErrorWithoutPath(err))
	}
	go d.maintainLoop()
	return d, nil
}

// Write дописывает запись в файл текущего дня; при смене дня и при заполнении части открывает
// следующий файл.
func (d *DailyFile) Write(p []byte) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return 0, os.ErrClosed
	}
	day := d.today()
	full := d.f != nil && day == d.day && d.size > 0 && d.size+int64(len(p)) > d.partBytes
	if d.f == nil || day != d.day || full {
		if err := d.rotateLocked(day, full); err != nil {
			d.reportLocked(err)
			return 0, err
		}
	}
	n, err := d.f.Write(p)
	d.size += int64(n)
	if err != nil {
		d.reportLocked(err)
	}
	return n, err
}

// Maintain удаляет файлы, вышедшие за срок. Вызывается раз в час и без записей в журнал:
// иначе на простаивающем сервере старые файлы лежали бы дольше срока.
func (d *DailyFile) Maintain() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return
	}
	if err := d.cleanupLocked(d.today()); err != nil {
		d.reportLocked(err)
	}
}

// Close останавливает обслуживание и закрывает файл.
func (d *DailyFile) Close() error {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return nil
	}
	d.closed = true
	f := d.f
	d.f = nil
	d.mu.Unlock()

	close(d.stop)
	<-d.done
	if f == nil {
		return nil
	}
	return f.Close()
}

func (d *DailyFile) maintainLoop() {
	defer close(d.done)
	t := time.NewTicker(logMaintainInterval)
	defer t.Stop()
	for {
		select {
		case <-d.stop:
			return
		case <-t.C:
			d.Maintain()
		}
	}
}

func (d *DailyFile) today() string {
	return d.now().UTC().Format(logDayLayout)
}

// rotateLocked открывает файл для дня day: последнюю его часть, а если она заполнена
// (или next — текущая запись в неё не помещается) — следующую.
func (d *DailyFile) rotateLocked(day string, next bool) error {
	if d.f != nil {
		_ = d.f.Close() // файл открыт на дозапись: всё записанное уже у ОС
		d.f = nil
	}
	files, err := d.listLocked()
	if err != nil {
		return err
	}
	part, size := 1, int64(0)
	for _, lf := range files {
		if lf.day == day && lf.part >= part {
			part, size = lf.part, lf.size
		}
	}
	if next || size >= d.partBytes {
		part++
	}
	name := logFilePrefix + day + logFileSuffix
	if part > 1 {
		name = logFilePrefix + day + "." + strconv.Itoa(part) + logFileSuffix
	}
	f, err := os.OpenFile(filepath.Join(d.dir, name), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600) //nolint:gosec // каталог журнала задаёт оператор
	if err != nil {
		return err
	}
	st, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return err
	}
	d.f, d.day, d.part, d.size = f, day, part, st.Size()
	// Файл открыт — запись идёт. Не удалось удалить старое — об этом сообщается, но записи
	// из-за этого не теряются.
	if err := d.cleanupLocked(day); err != nil {
		d.reportLocked(err)
	}
	return nil
}

// cleanupLocked удаляет файлы дней за пределами срока, затем самые старые части, пока вместе
// с местом под текущую часть журнал не уложится в предел размера. Файл с датой позже сегодняшней
// тоже за пределами срока: он остался от времени, когда часы спешили, и по сроку иначе не ушёл бы
// до наступления своей даты.
func (d *DailyFile) cleanupLocked(today string) error {
	files, err := d.listLocked()
	if err != nil {
		return err
	}
	t, err := time.Parse(logDayLayout, today)
	if err != nil {
		return err
	}
	cutoff := t.AddDate(0, 0, -(d.maxDays - 1)).Format(logDayLayout)

	var errs []error
	remove := func(lf logFile) {
		if lf.day == d.day && lf.part == d.part && d.f != nil {
			// Текущий файл вышел за срок: записей не было дольше срока хранения.
			_ = d.f.Close()
			d.f = nil
		}
		if err := d.remove(filepath.Join(d.dir, lf.name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			errs = append(errs, err)
		}
	}

	kept := files[:0]
	for _, lf := range files {
		if lf.day < cutoff || lf.day > today {
			remove(lf)
			continue
		}
		kept = append(kept, lf)
	}

	isCurrent := func(lf logFile) bool { return d.f != nil && lf.day == d.day && lf.part == d.part }
	var others int64
	for _, lf := range kept {
		if !isCurrent(lf) {
			others += lf.size
		}
	}
	budget := d.maxBytes - d.partBytes
	for _, lf := range kept {
		if others <= budget {
			break
		}
		if isCurrent(lf) {
			continue
		}
		remove(lf)
		others -= lf.size
	}
	return errors.Join(errs...)
}

// listLocked возвращает файлы журнала в каталоге от старых к новым. Всё, что не похоже на файл
// журнала, пропускается.
func (d *DailyFile) listLocked() ([]logFile, error) {
	return listLogFiles(d.dir)
}

func listLogFiles(dir string) ([]logFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var files []logFile
	for _, e := range entries {
		if !e.Type().IsRegular() {
			continue
		}
		m := logFileName.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		if _, err := time.Parse(logDayLayout, m[1]); err != nil {
			continue
		}
		part := 1
		if m[2] != "" {
			if part, err = strconv.Atoi(m[2]); err != nil || part < 2 {
				continue
			}
		}
		info, err := e.Info()
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, err
		}
		files = append(files, logFile{name: e.Name(), day: m[1], part: part, size: info.Size()})
	}
	slices.SortFunc(files, func(a, b logFile) int {
		return cmp.Or(cmp.Compare(a.day, b.day), cmp.Compare(a.part, b.part))
	})
	return files, nil
}

// reportLocked сообщает об ошибке записи или очистки журнала, не чаще раза в минуту: журнал
// о своих ошибках писать в себя не может, а засыпать stdout повторами незачем.
func (d *DailyFile) reportLocked(err error) {
	if d.onError == nil {
		return
	}
	now := d.now()
	if !d.lastErr.IsZero() && now.Sub(d.lastErr) < logErrorInterval {
		return
	}
	d.lastErr = now
	d.onError(err)
}

// ErrorWithoutPath возвращает текст ошибки файловой операции без пути: «open: permission denied».
// Путь каталога журнала задаёт оператор, и он может вести в домашний каталог (ADR-0025).
func ErrorWithoutPath(err error) string {
	var pathErr *fs.PathError
	if errors.As(err, &pathErr) {
		return pathErr.Op + ": " + pathErr.Err.Error()
	}
	var linkErr *os.LinkError
	if errors.As(err, &linkErr) {
		return linkErr.Op + ": " + linkErr.Err.Error()
	}
	var errno syscall.Errno
	if errors.As(err, &errno) {
		return errno.Error()
	}
	if errors.Is(err, os.ErrClosed) {
		return os.ErrClosed.Error()
	}
	return "ошибка файловой операции"
}

// TailLog выводит последние n строк журнала из каталога dir, от старых к новым; n ≤ 0 — весь журнал.
func TailLog(dir string, n int, w io.Writer) error {
	files, err := listLogFiles(dir)
	if err != nil {
		return fmt.Errorf("журнал: %s", ErrorWithoutPath(err))
	}
	// Идём от новых файлов к старым, пока не наберётся n строк; файл не больше одной части журнала.
	var chunks [][]string
	total := 0
	for i := len(files) - 1; i >= 0 && (n <= 0 || total < n); i-- {
		lines, err := readLines(filepath.Join(dir, files[i].name))
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue // файл удалила ротация, пока читали
			}
			return fmt.Errorf("журнал: %s", ErrorWithoutPath(err))
		}
		chunks = append(chunks, lines)
		total += len(lines)
	}
	skip := 0
	if n > 0 && total > n {
		skip = total - n
	}
	bw := bufio.NewWriter(w)
	for i := len(chunks) - 1; i >= 0; i-- {
		for _, line := range chunks[i] {
			if skip > 0 {
				skip--
				continue
			}
			if _, err := bw.WriteString(line + "\n"); err != nil {
				return err
			}
		}
	}
	return bw.Flush()
}

func readLines(path string) ([]string, error) {
	f, err := os.Open(path) //nolint:gosec // имя прошло проверку logFileName, каталог задаёт оператор
	if err != nil {
		return nil, err
	}
	defer f.Close() //nolint:errcheck // чтение; ошибка закрытия ничего не меняет
	var lines []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	return lines, sc.Err()
}
