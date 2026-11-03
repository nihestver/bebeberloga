// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

package mlswire

import "time"

// Сборщики синтетических сообщений для эмулятора клиентов и тестов DS. Заголовки — как у
// настоящих сообщений; «шифртекст» — произвольные байты: DS его не читает.

// BuildPrivateMessage — MLSMessage с PrivateMessage заданного заголовка.
func BuildPrivateMessage(groupID []byte, epoch uint64, contentType uint8, aad, body []byte) []byte {
	var w writer
	w.u16(VersionMLS10)
	w.u16(WireFormatPrivate)
	w.vector(groupID)
	w.u64(epoch)
	w.u8(contentType)
	w.vector(aad)
	w.vector(make([]byte, 16)) // encrypted_sender_data
	w.vector(body)
	return w.b
}

// BuildPublicCommit — MLSMessage с PublicMessage-commit от new_member_commit (external commit).
func BuildPublicCommit(groupID []byte, epoch uint64, aad, body []byte) []byte {
	var w writer
	w.u16(VersionMLS10)
	w.u16(WireFormatPublic)
	w.vector(groupID)
	w.u64(epoch)
	w.u8(SenderNewMemberCommit)
	w.vector(aad)
	w.u8(ContentCommit)
	w.raw(body)
	return w.b
}

// BuildWelcome — MLSMessage с Welcome для KeyPackageRef `refs`.
func BuildWelcome(refs [][]byte, body []byte) []byte {
	var secrets writer
	for _, ref := range refs {
		secrets.vector(ref)
		secrets.vector(make([]byte, 32)) // kem_output
		secrets.vector(make([]byte, 64)) // ciphertext
	}
	var w writer
	w.u16(VersionMLS10)
	w.u16(WireFormatWelcome)
	w.u16(CiphersuiteX25519AES128Ed25519)
	w.vector(secrets.b)
	w.vector(body)
	return w.b
}

// KeyPackageRef считает KeyPackageRef без проверки пакета.
func KeyPackageRef(raw []byte) []byte { return refHash(labelKeyPackageRef, raw) }

// KeyPackageFromExternalAdd достаёт KeyPackage из предложения Add external sender-а (нужно
// эмулятору коммитера: настоящий клиент делает это в OpenMLS). Подписи пакета проверяются,
// срок — нет.
func KeyPackageFromExternalAdd(msg []byte) (KeyPackage, error) {
	r := newReader(msg)
	if _, err := r.take(4); err != nil { // version, wire_format
		return KeyPackage{}, err
	}
	if _, err := r.vector(); err != nil { // group_id
		return KeyPackage{}, err
	}
	if _, err := r.take(8 + 1 + 4); err != nil { // epoch, sender_type, sender_index
		return KeyPackage{}, err
	}
	if _, err := r.vector(); err != nil { // authenticated_data
		return KeyPackage{}, err
	}
	ct, err := r.u8()
	if err != nil {
		return KeyPackage{}, err
	}
	pt, err := r.u16()
	if err != nil {
		return KeyPackage{}, err
	}
	if ct != ContentProposal || pt != ProposalAdd {
		return KeyPackage{}, ErrUnsupported
	}
	start := r.off
	// KeyPackage: version, cipher_suite, init_key, LeafNode{encryption_key, signature_key,
	// credential(type, identity), 5 векторов capabilities, source+lifetime, extensions,
	// signature}, extensions, signature.
	if _, err = r.take(4); err != nil {
		return KeyPackage{}, err
	}
	for range 3 {
		if _, err = r.vector(); err != nil {
			return KeyPackage{}, err
		}
	}
	if _, err = r.take(2); err != nil {
		return KeyPackage{}, err
	}
	for range 6 {
		if _, err = r.vector(); err != nil {
			return KeyPackage{}, err
		}
	}
	if _, err = r.take(1 + 16); err != nil {
		return KeyPackage{}, err
	}
	for range 4 {
		if _, err = r.vector(); err != nil {
			return KeyPackage{}, err
		}
	}
	return ParseKeyPackage(msg[start:r.off], KeyPackagePolicy{
		Now: time.Unix(0, 0), MaxLifetime: 1 << 62, ClockSkew: 1 << 62,
	})
}
