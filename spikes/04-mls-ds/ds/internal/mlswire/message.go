// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

package mlswire

import "bytes"

// Константы RFC 9420 (§6, §7.1, §17).
const (
	VersionMLS10 uint16 = 1

	CiphersuiteX25519AES128Ed25519 uint16 = 0x0001

	WireFormatPublic     uint16 = 1
	WireFormatPrivate    uint16 = 2
	WireFormatWelcome    uint16 = 3
	WireFormatGroupInfo  uint16 = 4
	WireFormatKeyPackage uint16 = 5

	ContentApplication uint8 = 1
	ContentProposal    uint8 = 2
	ContentCommit      uint8 = 3

	SenderMember            uint8 = 1
	SenderExternal          uint8 = 2
	SenderNewMemberProposal uint8 = 3
	SenderNewMemberCommit   uint8 = 4

	ProposalAdd    uint16 = 1
	ProposalRemove uint16 = 3

	CredentialBasic uint16 = 1
	CredentialX509  uint16 = 2

	ExtensionExternalSenders uint16 = 5

	LeafSourceKeyPackage uint8 = 1
	LeafSourceUpdate     uint8 = 2
	LeafSourceCommit     uint8 = 3
)

// Header — то, что DS видит в handshake-сообщении без ключей группы. Для PrivateMessage
// отправитель зашифрован (SenderType = 0); для PublicMessage он открыт. Заголовок для
// сервера не аутентифицирован: подпись и membership tag DS не проверяет (ключей эпохи нет),
// поэтому поля — только подсказка для сериализации и маршрутизации (ADR-0016 п. 4).
type Header struct {
	WireFormat  uint16
	GroupID     []byte
	Epoch       uint64
	ContentType uint8
	SenderType  uint8
	// AAD — authenticated_data: открыт и в PublicMessage, и в PrivateMessage; участники
	// проверяют его целостность (он входит в AEAD / подпись), сервер — только читает.
	AAD []byte
}

// ParseHeader разбирает MLSMessage с PublicMessage или PrivateMessage и возвращает открытый
// заголовок. Тело (содержимое предложения, commit, шифртекст) не разбирается.
func ParseHeader(msg []byte) (Header, error) {
	r := newReader(msg)
	version, err := r.u16()
	if err != nil {
		return Header{}, err
	}
	if version != VersionMLS10 {
		return Header{}, ErrUnsupported
	}
	wf, err := r.u16()
	if err != nil {
		return Header{}, err
	}
	h := Header{WireFormat: wf}
	switch wf {
	case WireFormatPublic:
		// FramedContent: group_id, epoch, sender, authenticated_data, content_type, ...
		if h.GroupID, err = r.vector(); err != nil {
			return Header{}, err
		}
		if h.Epoch, err = r.u64(); err != nil {
			return Header{}, err
		}
		if h.SenderType, err = r.u8(); err != nil {
			return Header{}, err
		}
		switch h.SenderType {
		case SenderMember, SenderExternal:
			if _, err = r.u32(); err != nil {
				return Header{}, err
			}
		case SenderNewMemberProposal, SenderNewMemberCommit:
		default:
			return Header{}, ErrUnsupported
		}
		if h.AAD, err = r.vector(); err != nil {
			return Header{}, err
		}
		if h.ContentType, err = r.u8(); err != nil {
			return Header{}, err
		}
	case WireFormatPrivate:
		// PrivateMessage: group_id, epoch, content_type, authenticated_data, ...
		if h.GroupID, err = r.vector(); err != nil {
			return Header{}, err
		}
		if h.Epoch, err = r.u64(); err != nil {
			return Header{}, err
		}
		if h.ContentType, err = r.u8(); err != nil {
			return Header{}, err
		}
		if h.AAD, err = r.vector(); err != nil {
			return Header{}, err
		}
		if _, err = r.vector(); err != nil { // encrypted_sender_data
			return Header{}, err
		}
		if _, err = r.vector(); err != nil { // ciphertext
			return Header{}, err
		}
		if err = r.end(); err != nil {
			return Header{}, err
		}
	default:
		return Header{}, ErrUnsupported
	}
	if h.ContentType < ContentApplication || h.ContentType > ContentCommit {
		return Header{}, ErrUnsupported
	}
	return h, nil
}

// WelcomeHeader — открытая часть Welcome (RFC 9420 §12.4.3.1): ciphersuite и KeyPackageRef
// каждого нового участника. По ним DS понимает, каким устройствам адресован Welcome.
type WelcomeHeader struct {
	Ciphersuite uint16
	NewMembers  [][]byte
}

// SplitWelcome возвращает Welcome только с записью EncryptedGroupSecrets для `ref`:
// получателю чужие записи не нужны (он ищет свою по KeyPackageRef, RFC 9420 §12.4.3.1), а
// при пачке в сотни новичков они составляют до половины размера. encrypted_group_info общий.
func SplitWelcome(msg, ref []byte) ([]byte, error) {
	r := newReader(msg)
	if _, err := r.take(4); err != nil { // version, wire_format — проверены при приёме
		return nil, err
	}
	cs, err := r.u16()
	if err != nil {
		return nil, err
	}
	secrets, err := r.vector()
	if err != nil {
		return nil, err
	}
	var own []byte
	sr := newReader(secrets)
	for sr.remaining() > 0 {
		start := sr.off
		got, err := sr.vector()
		if err != nil {
			return nil, err
		}
		for range 2 {
			if _, err = sr.vector(); err != nil {
				return nil, err
			}
		}
		if bytes.Equal(got, ref) {
			own = secrets[start:sr.off]
		}
	}
	if own == nil {
		return nil, ErrUnsupported
	}
	gi, err := r.vector()
	if err != nil {
		return nil, err
	}
	var w writer
	w.u16(VersionMLS10)
	w.u16(WireFormatWelcome)
	w.u16(cs)
	w.vector(own)
	w.vector(gi)
	return w.b, nil
}

// ParseWelcome разбирает MLSMessage с Welcome.
func ParseWelcome(msg []byte) (WelcomeHeader, error) {
	r := newReader(msg)
	version, err := r.u16()
	if err != nil {
		return WelcomeHeader{}, err
	}
	wf, err := r.u16()
	if err != nil {
		return WelcomeHeader{}, err
	}
	if version != VersionMLS10 || wf != WireFormatWelcome {
		return WelcomeHeader{}, ErrUnsupported
	}
	var w WelcomeHeader
	if w.Ciphersuite, err = r.u16(); err != nil {
		return WelcomeHeader{}, err
	}
	secrets, err := r.vector()
	if err != nil {
		return WelcomeHeader{}, err
	}
	sr := newReader(secrets)
	seen := map[string]bool{}
	for sr.remaining() > 0 {
		ref, err := sr.vector() // KeyPackageRef new_member
		if err != nil {
			return WelcomeHeader{}, err
		}
		if seen[string(ref)] {
			return WelcomeHeader{}, ErrUnsupported // два получателя с одним KeyPackageRef
		}
		seen[string(ref)] = true
		if _, err = sr.vector(); err != nil { // HPKECiphertext.kem_output
			return WelcomeHeader{}, err
		}
		if _, err = sr.vector(); err != nil { // HPKECiphertext.ciphertext
			return WelcomeHeader{}, err
		}
		w.NewMembers = append(w.NewMembers, ref)
	}
	if _, err = r.vector(); err != nil { // encrypted_group_info
		return WelcomeHeader{}, err
	}
	if err = r.end(); err != nil {
		return WelcomeHeader{}, err
	}
	return w, nil
}
