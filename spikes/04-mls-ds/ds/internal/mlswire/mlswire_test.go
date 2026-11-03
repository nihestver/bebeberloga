// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

package mlswire

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func newKP(t testing.TB, identity string, notAfter time.Duration) ([]byte, ed25519.PrivateKey) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	init, enc := make([]byte, 32), make([]byte, 32)
	_, _ = rand.Read(init)
	_, _ = rand.Read(enc)
	now := time.Now()
	return BuildKeyPackage(KeyPackageParams{
		Signer: priv, Identity: []byte(identity), InitKey: init, EncryptionKey: enc,
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(notAfter),
	}), priv
}

// newKPCaps — KeyPackage с заданным вектором cipher_suites в capabilities.
func newKPCaps(t testing.TB, identity string, cipherSuites []byte) ([]byte, ed25519.PrivateKey) {
	t.Helper()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	init, enc := make([]byte, 32), make([]byte, 32)
	_, _ = rand.Read(init)
	_, _ = rand.Read(enc)
	now := time.Now()
	return BuildKeyPackage(KeyPackageParams{
		Signer: priv, Identity: []byte(identity), InitKey: init, EncryptionKey: enc,
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), CipherSuites: cipherSuites,
	}), priv
}

var policy = func() KeyPackagePolicy {
	return KeyPackagePolicy{Now: time.Now(), MaxLifetime: 90 * 24 * time.Hour, ClockSkew: 5 * time.Minute}
}

func TestKeyPackageRoundTrip(t *testing.T) {
	raw, priv := newKP(t, "dev-1", 30*24*time.Hour)
	kp, err := ParseKeyPackage(raw, policy())
	if err != nil {
		t.Fatal(err)
	}
	if string(kp.Identity) != "dev-1" || !bytes.Equal(kp.SignatureKey, priv.Public().(ed25519.PublicKey)) {
		t.Fatalf("поля: %+v", kp)
	}
	if !bytes.Equal(kp.Ref, KeyPackageRef(raw)) || len(kp.Ref) != 32 {
		t.Fatal("ref")
	}
}

func TestKeyPackageRejects(t *testing.T) {
	raw, _ := newKP(t, "dev-1", 30*24*time.Hour)
	long, _ := newKP(t, "dev-1", 100*365*24*time.Hour)
	if _, err := ParseKeyPackage(long, policy()); !errors.Is(err, ErrKeyPackageLifetime) {
		t.Fatalf("пакет на 100 лет: %v", err)
	}
	expired, _ := newKP(t, "dev-1", -time.Minute)
	if _, err := ParseKeyPackage(expired, policy()); !errors.Is(err, ErrKeyPackageLifetime) {
		t.Fatalf("истёкший пакет: %v", err)
	}
	// Любой изменённый байт ломает подпись или разбор.
	for _, i := range []int{6, 40, 80, len(raw) - 70, len(raw) - 1} {
		bad := slices.Clone(raw)
		bad[i] ^= 1
		if _, err := ParseKeyPackage(bad, policy()); err == nil {
			t.Fatalf("байт %d изменён, пакет принят", i)
		}
	}
	if _, err := ParseKeyPackage(append(slices.Clone(raw), 0), policy()); !errors.Is(err, ErrTrailing) {
		t.Fatalf("хвост: %v", err)
	}
	// Capabilities без ciphersuite 0x0001: участник не смог бы закоммитить такой Add.
	// Расширение листа, которого нет в capabilities, и расширение, недопустимое в листе (П1).
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	ext := func(leafExt, capExt []byte) []byte {
		init, enc := make([]byte, 32), make([]byte, 32)
		_, _ = rand.Read(init)
		_, _ = rand.Read(enc)
		return BuildKeyPackage(KeyPackageParams{
			Signer: priv, Identity: []byte("dev-1"), InitKey: init, EncryptionKey: enc,
			NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
			LeafExtensions: leafExt, CapExtensions: capExt,
		})
	}
	if _, err := ParseKeyPackage(ext([]byte{0xff, 0x00, 0x00}, nil), policy()); !errors.Is(err, ErrKeyPackageExtensions) {
		t.Fatalf("расширение не из capabilities: %v", err)
	}
	if _, err := ParseKeyPackage(ext([]byte{0x00, 0x05, 0x00}, []byte{0x00, 0x05}), policy()); !errors.Is(err, ErrKeyPackageExtensions) {
		t.Fatalf("external_senders в листе: %v", err)
	}
	if _, err := ParseKeyPackage(ext([]byte{0xff, 0x00, 0x00}, []byte{0xff, 0x00}), policy()); err != nil {
		t.Fatalf("расширение из capabilities: %v", err)
	}
	if _, err := ParseKeyPackage(ext([]byte{0x00, 0x01, 0x01, 0x07}, nil), policy()); err != nil {
		t.Fatalf("application_id: %v", err)
	}
	noCS, _ := newKPCaps(t, "dev-1", []byte{0, 2})
	if _, err := ParseKeyPackage(noCS, policy()); !errors.Is(err, ErrKeyPackageCapabilities) {
		t.Fatalf("capabilities без 0x0001: %v", err)
	}
	w := BuildWelcome([][]byte{[]byte("r"), []byte("r")}, nil)
	if _, err := ParseWelcome(w); err == nil {
		t.Fatal("Welcome с повторяющимся KeyPackageRef принят")
	}
}

func TestHeaders(t *testing.T) {
	gid := []byte("group-1")
	d := RosterDelta{Removed: []uint32{3}, Added: []AddedLeaf{{Leaf: 3, DeviceID: []byte("d9")}}}
	pm := BuildPrivateMessage(gid, 7, ContentCommit, d.Encode(), []byte("ct"))
	h, err := ParseHeader(pm)
	if err != nil {
		t.Fatal(err)
	}
	if h.WireFormat != WireFormatPrivate || !bytes.Equal(h.GroupID, gid) || h.Epoch != 7 || h.ContentType != ContentCommit {
		t.Fatalf("%+v", h)
	}
	got, err := ParseRosterDelta(h.AAD)
	if err != nil || !slices.Equal(got.Removed, d.Removed) || string(got.Added[0].DeviceID) != "d9" {
		t.Fatalf("дельта: %+v %v", got, err)
	}

	_, key, _ := ed25519.GenerateKey(rand.Reader)
	es := ExternalSender{Key: key, Identity: []byte("ds")}
	kp, _ := newKP(t, "dev-2", time.Hour)
	aad := ProposalAAD("dev-2")
	for _, msg := range [][]byte{es.ProposeAdd(gid, 9, kp, aad), es.ProposeRemove(gid, 9, 4, aad)} {
		h, err = ParseHeader(msg)
		if err != nil {
			t.Fatal(err)
		}
		if h.WireFormat != WireFormatPublic || h.SenderType != SenderExternal || h.Epoch != 9 || h.ContentType != ContentProposal {
			t.Fatalf("%+v", h)
		}
		if id, err := ParseProposalAAD(h.AAD); err != nil || id != "dev-2" {
			t.Fatalf("AAD предложения: %q %v", id, err)
		}
	}
	if _, err = ParseProposalAAD(nil); err == nil {
		t.Fatal("пустой AAD предложения принят")
	}

	got2, err := KeyPackageFromExternalAdd(es.ProposeAdd(gid, 9, kp, aad))
	if err != nil || string(got2.Identity) != "dev-2" || !bytes.Equal(got2.Ref, KeyPackageRef(kp)) {
		t.Fatalf("KeyPackage из Add: %+v %v", got2, err)
	}

	ext := BuildPublicCommit(gid, 2, d.Encode(), []byte("commit"))
	if h, err = ParseHeader(ext); err != nil || h.SenderType != SenderNewMemberCommit {
		t.Fatalf("%+v %v", h, err)
	}

	w := BuildWelcome([][]byte{[]byte("ref-a"), []byte("ref-b")}, []byte("gi"))
	wh, err := ParseWelcome(w)
	if err != nil || len(wh.NewMembers) != 2 || string(wh.NewMembers[1]) != "ref-b" {
		t.Fatalf("%+v %v", wh, err)
	}
	one, err := SplitWelcome(w, []byte("ref-b"))
	if err != nil {
		t.Fatal(err)
	}
	if wh, err = ParseWelcome(one); err != nil || len(wh.NewMembers) != 1 || string(wh.NewMembers[0]) != "ref-b" {
		t.Fatalf("split: %+v %v", wh, err)
	}
	if _, err = SplitWelcome(w, []byte("ref-x")); err == nil {
		t.Fatal("чужой ref")
	}
}

func TestVarintMinimal(t *testing.T) {
	// 0x40 0x05 — длина 5 в двухбайтовой форме: не минимальная, отвергается.
	if _, err := newReader([]byte{0x40, 0x05}).varint(); !errors.Is(err, ErrVarint) {
		t.Fatal(err)
	}
	if _, err := newReader([]byte{0xc0, 0, 0, 0, 0, 0, 0, 1}).varint(); !errors.Is(err, ErrVarint) {
		t.Fatal(err)
	}
	for _, n := range []int{0, 63, 64, 16383, 16384, 1 << 20} {
		var w writer
		w.varint(n)
		got, err := newReader(w.b).varint()
		if err != nil || got != n {
			t.Fatalf("%d: %d %v", n, got, err)
		}
	}
}

func TestDeltaRejectsDuplicates(t *testing.T) {
	for _, d := range []RosterDelta{
		{Removed: []uint32{1, 1}},
		{Added: []AddedLeaf{{Leaf: 1, DeviceID: []byte("a")}, {Leaf: 1, DeviceID: []byte("b")}}},
		{Added: []AddedLeaf{{Leaf: 1, DeviceID: []byte("a")}, {Leaf: 2, DeviceID: []byte("a")}}},
	} {
		if _, err := ParseRosterDelta(d.Encode()); !errors.Is(err, ErrDelta) {
			t.Fatalf("%+v: %v", d, err)
		}
	}
}

func TestAssignLeaves(t *testing.T) {
	occ := map[uint32]struct{}{0: {}, 1: {}, 3: {}, 4: {}}
	// Удаление 3: свободны 2 и 3, затем дерево растёт вправо с 5.
	got := AssignLeaves(occ, []uint32{3}, 4)
	if !slices.Equal(got, []uint32{2, 3, 5, 6}) {
		t.Fatal(got)
	}
	if got = AssignLeaves(map[uint32]struct{}{}, nil, 2); !slices.Equal(got, []uint32{0, 1}) {
		t.Fatal(got)
	}
}

// Векторы от OpenMLS (cargo run --bin vectors в client/): разбор настоящих сообщений.
func TestOpenMLSVectors(t *testing.T) {
	dir := filepath.Join("..", "..", "testdata", "openmls")
	read := func(name string) []byte {
		b, err := os.ReadFile(filepath.Join(dir, name)) //nolint:gosec // фиксированные имена векторов
		if err != nil {
			t.Skipf("нет векторов OpenMLS (%v): запустите `just vectors`", err)
		}
		return b
	}
	gid := read("group_id.bin")
	kpRaw := read("key_package.bin")
	// Срок пакета считается от момента генерации векторов, иначе тест «протухнет».
	generated := time.Unix(int64(binary.BigEndian.Uint64(read("generated_at.bin"))), 0) //nolint:gosec
	kp, err := ParseKeyPackage(kpRaw, KeyPackagePolicy{
		Now: generated, MaxLifetime: 90 * 24 * time.Hour, ClockSkew: time.Minute,
	})
	if err != nil {
		t.Fatalf("KeyPackage OpenMLS: %v", err)
	}
	if string(kp.Identity) != "vec-joiner" {
		t.Fatalf("identity %q", kp.Identity)
	}

	commit := read("commit.bin")
	h, err := ParseHeader(commit)
	if err != nil {
		t.Fatal(err)
	}
	if h.WireFormat != WireFormatPrivate || h.ContentType != ContentCommit || !bytes.Equal(h.GroupID, gid) || h.Epoch != 0 {
		t.Fatalf("commit: %+v", h)
	}
	d, err := ParseRosterDelta(h.AAD)
	if err != nil || len(d.Added) != 1 || d.Added[0].Leaf != 1 || string(d.Added[0].DeviceID) != "vec-joiner" {
		t.Fatalf("дельта из commit OpenMLS: %+v %v", d, err)
	}

	wh, err := ParseWelcome(read("welcome.bin"))
	if err != nil || len(wh.NewMembers) != 1 || !bytes.Equal(wh.NewMembers[0], kp.Ref) {
		t.Fatalf("Welcome: KeyPackageRef не совпал с вычисленным DS: %+v %v", wh, err)
	}

	// Предложение, подписанное OpenMLS ключом external sender-а, побайтно совпадает с
	// предложением, которое подписывает DS тем же ключом (Ed25519 детерминирован).
	seed := read("external_sender_seed.bin")
	es := ExternalSender{Key: ed25519.NewKeyFromSeed(seed), Identity: []byte("vec-ds")}
	if !bytes.Equal(es.Entry(), read("external_sender.bin")) {
		t.Fatal("ExternalSender для extension не совпал с OpenMLS")
	}
	if !bytes.Equal(es.ProposeAdd(gid, 1, kpRaw, nil), read("external_add.bin")) {
		t.Fatal("Add от DS не совпал с OpenMLS")
	}
	if !bytes.Equal(es.ProposeRemove(gid, 1, 1, nil), read("external_remove.bin")) {
		t.Fatal("Remove от DS не совпал с OpenMLS")
	}
}

func FuzzParseHeader(f *testing.F) {
	f.Add(BuildPrivateMessage([]byte("g"), 1, ContentCommit, nil, []byte("x")))
	f.Add(BuildPublicCommit([]byte("g"), 1, nil, []byte("x")))
	f.Fuzz(func(_ *testing.T, b []byte) { _, _ = ParseHeader(b) })
}

func FuzzParseWelcome(f *testing.F) {
	f.Add(BuildWelcome([][]byte{[]byte("r")}, []byte("x")))
	f.Fuzz(func(_ *testing.T, b []byte) { _, _ = ParseWelcome(b) })
}

func FuzzParseKeyPackage(f *testing.F) {
	raw, _ := newKP(f, "d", time.Hour)
	f.Add(raw)
	f.Fuzz(func(_ *testing.T, b []byte) { _, _ = ParseKeyPackage(b, policy()) })
}

func FuzzSplitWelcome(f *testing.F) {
	f.Add(BuildWelcome([][]byte{[]byte("r1"), []byte("r2")}, []byte("gi")), []byte("r2"))
	f.Fuzz(func(t *testing.T, msg, ref []byte) {
		out, err := SplitWelcome(msg, ref)
		if err != nil {
			return
		}
		// Результат — корректный Welcome ровно для запрошенного адресата.
		wh, err := ParseWelcome(out)
		if err != nil || len(wh.NewMembers) != 1 || !bytes.Equal(wh.NewMembers[0], ref) {
			t.Fatalf("нарезка: %+v %v", wh, err)
		}
	})
}

func FuzzParseProposalAAD(f *testing.F) {
	f.Add(ProposalAAD("dev-1"))
	f.Fuzz(func(t *testing.T, b []byte) {
		id, err := ParseProposalAAD(b)
		if err == nil && !bytes.Equal(ProposalAAD(id), b) {
			t.Fatal("AAD предложения не круговой")
		}
	})
}

func FuzzParseRosterDelta(f *testing.F) {
	f.Add(RosterDelta{Removed: []uint32{1}, Added: []AddedLeaf{{Leaf: 1, DeviceID: []byte("a")}}}.Encode())
	f.Fuzz(func(t *testing.T, b []byte) {
		d, err := ParseRosterDelta(b)
		if err == nil && !bytes.Equal(d.Encode(), b) {
			t.Fatal("дельта не круговая")
		}
	})
}
