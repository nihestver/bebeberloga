// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

package mlswire

import (
	"crypto/ed25519"
)

const labelFramedContentTBS = "FramedContentTBS"

// ProposalAADVersion — версия формата authenticated_data предложений сервера.
const ProposalAADVersion uint8 = 1

// ProposalAAD — authenticated_data предложения сервера: {uint8 version = 1; opaque device_id<V>}.
// Поле входит в подпись сервера, поэтому Add и Remove привязаны к устройству: клиент сверяет
// id с credential добавляемого KeyPackage или с листом, который удаляется, и не даст
// подменить цель Remove, если карта листьев DS разошлась с деревом.
func ProposalAAD(deviceID string) []byte {
	var w writer
	w.u8(ProposalAADVersion)
	w.vector([]byte(deviceID))
	return w.b
}

// ParseProposalAAD возвращает id устройства из authenticated_data предложения сервера.
func ParseProposalAAD(aad []byte) (string, error) {
	r := newReader(aad)
	v, err := r.u8()
	if err != nil {
		return "", err
	}
	if v != ProposalAADVersion {
		return "", ErrUnsupported
	}
	id, err := r.vector()
	if err != nil {
		return "", err
	}
	if err = r.end(); err != nil {
		return "", err
	}
	if len(id) == 0 {
		return "", ErrUnsupported
	}
	return string(id), nil
}

// ExternalSender — сервер в роли external sender (RFC 9420 §12.1.8.1). У него есть только
// собственный подписывающий ключ; ключей групп нет. Ключ записывается клиентом-создателем в
// extension `external_senders` группы, индекс сервера в нём — Index.
type ExternalSender struct {
	Key      ed25519.PrivateKey
	Identity []byte
	Index    uint32
}

// Entry — TLS-кодировка ExternalSender{signature_key, credential} для extension группы.
func (s ExternalSender) Entry() []byte {
	var w writer
	w.vector(s.Key.Public().(ed25519.PublicKey))
	w.u16(CredentialBasic)
	w.vector(s.Identity)
	return w.b
}

// ProposeAdd — подписанное предложение Add устройства с KeyPackage `kp` (как есть, без
// обёртки MLSMessage) в эпохе `epoch` группы `groupID` с authenticated_data `aad`
// (см. ProposalAAD); MLSMessage с PublicMessage.
func (s ExternalSender) ProposeAdd(groupID []byte, epoch uint64, kp, aad []byte) []byte {
	var p writer
	p.u16(ProposalAdd)
	p.raw(kp)
	return s.publicProposal(groupID, epoch, aad, p.b)
}

// ProposeRemove — подписанное предложение Remove листа `leaf`.
func (s ExternalSender) ProposeRemove(groupID []byte, epoch uint64, leaf uint32, aad []byte) []byte {
	var p writer
	p.u16(ProposalRemove)
	p.u32(leaf)
	return s.publicProposal(groupID, epoch, aad, p.b)
}

func (s ExternalSender) publicProposal(groupID []byte, epoch uint64, aad, proposal []byte) []byte {
	// FramedContent
	var fc writer
	fc.vector(groupID)
	fc.u64(epoch)
	fc.u8(SenderExternal)
	fc.u32(s.Index)
	fc.vector(aad) // authenticated_data
	fc.u8(ContentProposal)
	fc.raw(proposal)

	// MLSMessage-префикс совпадает с началом FramedContentTBS (version, wire_format); у
	// отправителя external контекст группы в TBS не входит (RFC 9420 §6.1) — поэтому сервер
	// может подписать предложение, не зная GroupContext.
	var msg writer
	msg.u16(VersionMLS10)
	msg.u16(WireFormatPublic)
	msg.raw(fc.b)
	sig := signWithLabel(s.Key, labelFramedContentTBS, msg.b)
	msg.vector(sig) // FramedContentAuthData.signature; у proposal confirmation_tag нет
	// membership_tag есть только у отправителя member.
	return msg.b
}
