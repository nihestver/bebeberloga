// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

package mlswire

import (
	"bytes"
	"errors"
	"slices"
	"unicode/utf8"
)

// RosterDeltaVersion — версия формата дельты состава в authenticated_data commit-а.
const RosterDeltaVersion uint8 = 1

// ErrDelta — дельта состава неверна по форме.
var ErrDelta = errors.New("mlswire: неверная дельта состава")

// AddedLeaf — новый лист: индекс и id устройства (Basic credential identity в спайке; в
// продукте — id устройства из credential, подписанного ключом идентичности).
type AddedLeaf struct {
	Leaf     uint32
	DeviceID []byte
}

// RosterDelta — «дельта состава», которую автор commit-а кладёт в authenticated_data
// (формат спайка S4):
//
//	struct {
//	    uint8     version = 1;
//	    uint32    removed<V>;   // удалённые листья
//	    AddedLeaf added<V>;     // {uint32 leaf; opaque device_id<V>;} в порядке применения
//	} RosterDelta;
//
// device_id — непустая строка UTF-8; длины — минимальные varint (как и везде в RFC 9420).
// Та же грамматика у клиента (`client/src/delta.rs`).
//
// authenticated_data открыт серверу и защищён AEAD (PrivateMessage) или подписью
// (PublicMessage) для участников: DS ведёт по дельте карту листьев, а каждый участник до merge
// сверяет дельту с фактическим действием commit-а и отвергает commit при расхождении.
type RosterDelta struct {
	Removed []uint32
	Added   []AddedLeaf
}

// Encode сериализует дельту.
func (d RosterDelta) Encode() []byte {
	var rem writer
	for _, l := range d.Removed {
		rem.u32(l)
	}
	var add writer
	for _, a := range d.Added {
		add.u32(a.Leaf)
		add.vector(a.DeviceID)
	}
	var w writer
	w.u8(RosterDeltaVersion)
	w.vector(rem.b)
	w.vector(add.b)
	return w.b
}

// ParseRosterDelta разбирает дельту и проверяет форму: без повторов листьев и устройств.
func ParseRosterDelta(b []byte) (RosterDelta, error) {
	r := newReader(b)
	v, err := r.u8()
	if err != nil {
		return RosterDelta{}, err
	}
	if v != RosterDeltaVersion {
		return RosterDelta{}, ErrUnsupported
	}
	remB, err := r.vector()
	if err != nil {
		return RosterDelta{}, err
	}
	addB, err := r.vector()
	if err != nil {
		return RosterDelta{}, err
	}
	if err = r.end(); err != nil {
		return RosterDelta{}, err
	}
	if len(remB)%4 != 0 {
		return RosterDelta{}, ErrDelta
	}
	var d RosterDelta
	rr := newReader(remB)
	for rr.remaining() > 0 {
		l, _ := rr.u32()
		d.Removed = append(d.Removed, l)
	}
	ar := newReader(addB)
	for ar.remaining() > 0 {
		l, err := ar.u32()
		if err != nil {
			return RosterDelta{}, err
		}
		id, err := ar.vector()
		if err != nil {
			return RosterDelta{}, err
		}
		if len(id) == 0 || !utf8.Valid(id) {
			return RosterDelta{}, ErrDelta
		}
		d.Added = append(d.Added, AddedLeaf{Leaf: l, DeviceID: bytes.Clone(id)})
	}
	if hasDup(d.Removed) {
		return RosterDelta{}, ErrDelta
	}
	leaves := make([]uint32, 0, len(d.Added))
	ids := make([]string, 0, len(d.Added))
	for _, a := range d.Added {
		leaves = append(leaves, a.Leaf)
		ids = append(ids, string(a.DeviceID))
	}
	if hasDup(leaves) || hasDup(ids) {
		return RosterDelta{}, ErrDelta
	}
	return d, nil
}

func hasDup[T comparable](s []T) bool {
	seen := make(map[T]struct{}, len(s))
	for _, v := range s {
		if _, ok := seen[v]; ok {
			return true
		}
		seen[v] = struct{}{}
	}
	return false
}

// AssignLeaves — индексы, которые получат `n` добавляемых листьев после удаления `removed`
// из занятых `occupied`: по RFC 9420 §12.1.1 каждый Add занимает самый левый пустой лист,
// иначе дерево расширяется вправо; Remove применяются раньше Add (§12.3). Одна и та же функция
// у автора commit-а, у получателей и у DS даёт одинаковый результат без доступа к дереву.
func AssignLeaves(occupied map[uint32]struct{}, removed []uint32, n int) []uint32 {
	taken := make(map[uint32]struct{}, len(occupied))
	for l := range occupied {
		taken[l] = struct{}{}
	}
	for _, l := range removed {
		delete(taken, l)
	}
	out := make([]uint32, 0, n)
	for next := uint32(0); len(out) < n; next++ {
		if _, ok := taken[next]; !ok {
			out = append(out, next)
		}
	}
	return out
}

// SameLeaves — совпадают ли множества листьев (порядок не важен).
func SameLeaves(a, b []uint32) bool {
	if len(a) != len(b) {
		return false
	}
	x, y := slices.Clone(a), slices.Clone(b)
	slices.Sort(x)
	slices.Sort(y)
	return slices.Equal(x, y)
}
