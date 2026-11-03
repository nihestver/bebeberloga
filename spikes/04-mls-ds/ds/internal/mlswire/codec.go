// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

// Package mlswire — минимальный разбор и сборка структур MLS (RFC 9420), которые нужны
// Delivery Service: открытые заголовки сообщений, KeyPackage, заголовок Welcome и
// предложения Add/Remove от external sender. Ключей групп и расшифровки здесь нет и быть
// не может: сервер видит только то, что RFC оставляет открытым.
package mlswire

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// Ошибки разбора. Тексты не содержат фрагментов входа.
var (
	ErrTruncated   = errors.New("mlswire: данные обрезаны")
	ErrTrailing    = errors.New("mlswire: лишние байты в конце")
	ErrVarint      = errors.New("mlswire: неверная длина вектора")
	ErrUnsupported = errors.New("mlswire: неподдерживаемое значение")
	ErrTooLarge    = errors.New("mlswire: вектор больше допустимого")
)

// maxVector ограничивает длину любого вектора: защита от выделения памяти по длине из входа.
// 4 МиБ с запасом покрывает commit и Welcome группы в 5 000 листьев (~0,5 МиБ).
const maxVector = 4 << 20

// reader читает TLS-кодировку RFC 9420 §2.1 с переменной длиной векторов (§2.1.2).
type reader struct {
	b   []byte
	off int
}

func newReader(b []byte) *reader { return &reader{b: b} }

func (r *reader) remaining() int { return len(r.b) - r.off }

func (r *reader) take(n int) ([]byte, error) {
	if n < 0 || r.remaining() < n {
		return nil, ErrTruncated
	}
	out := r.b[r.off : r.off+n]
	r.off += n
	return out, nil
}

func (r *reader) u8() (uint8, error) {
	b, err := r.take(1)
	if err != nil {
		return 0, err
	}
	return b[0], nil
}

func (r *reader) u16() (uint16, error) {
	b, err := r.take(2)
	if err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint16(b), nil
}

func (r *reader) u32() (uint32, error) {
	b, err := r.take(4)
	if err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint32(b), nil
}

func (r *reader) u64() (uint64, error) {
	b, err := r.take(8)
	if err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint64(b), nil
}

// varint — длина вектора: 2 старших бита первого байта задают 1, 2 или 4 байта; значение
// обязано быть закодировано минимальным числом байт (RFC 9420 §2.1.2).
func (r *reader) varint() (int, error) {
	first, err := r.u8()
	if err != nil {
		return 0, err
	}
	prefix := first >> 6
	v := uint32(first & 0x3f)
	switch prefix {
	case 0:
		return int(v), nil
	case 1:
		b, err := r.u8()
		if err != nil {
			return 0, err
		}
		v = v<<8 | uint32(b)
		if v < 1<<6 {
			return 0, ErrVarint
		}
	case 2:
		b, err := r.take(3)
		if err != nil {
			return 0, err
		}
		v = v<<24 | uint32(b[0])<<16 | uint32(b[1])<<8 | uint32(b[2])
		if v < 1<<14 {
			return 0, ErrVarint
		}
	default:
		return 0, ErrVarint
	}
	if v > maxVector {
		return 0, ErrTooLarge
	}
	return int(v), nil
}

// vector читает opaque<V> и возвращает срез входного буфера (без копии).
func (r *reader) vector() ([]byte, error) {
	n, err := r.varint()
	if err != nil {
		return nil, err
	}
	return r.take(n)
}

func (r *reader) end() error {
	if r.remaining() != 0 {
		return ErrTrailing
	}
	return nil
}

// writer собирает TLS-кодировку.
type writer struct{ b []byte }

func (w *writer) u8(v uint8)   { w.b = append(w.b, v) }
func (w *writer) u16(v uint16) { w.b = binary.BigEndian.AppendUint16(w.b, v) }
func (w *writer) u32(v uint32) { w.b = binary.BigEndian.AppendUint32(w.b, v) }
func (w *writer) u64(v uint64) { w.b = binary.BigEndian.AppendUint64(w.b, v) }
func (w *writer) raw(b []byte) { w.b = append(w.b, b...) }

func (w *writer) varint(n int) {
	switch {
	case n < 1<<6:
		w.u8(uint8(n)) //nolint:gosec // n < 64
	case n < 1<<14:
		w.u16(uint16(n) | 0x4000)
	case n < 1<<30:
		w.u32(uint32(n) | 0x8000_0000)
	default:
		panic(fmt.Sprintf("mlswire: вектор %d байт не кодируется", n))
	}
}

func (w *writer) vector(b []byte) {
	w.varint(len(b))
	w.raw(b)
}

// AppendVector добавляет opaque<V> к buf (нужно форматам приложения поверх MLS, например
// дельте состава в authenticated_data).
func AppendVector(buf, v []byte) []byte {
	w := writer{b: buf}
	w.vector(v)
	return w.b
}
