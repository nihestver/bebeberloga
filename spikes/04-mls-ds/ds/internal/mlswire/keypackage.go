// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

package mlswire

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"time"
)

// Ошибки проверки KeyPackage.
var (
	ErrKeyPackageSignature = errors.New("mlswire: подпись KeyPackage неверна")
	ErrKeyPackageLifetime  = errors.New("mlswire: срок действия KeyPackage вне допустимого")
	ErrKeyPackageKeys      = errors.New("mlswire: ключи KeyPackage неверного размера или совпадают")
	// ErrKeyPackageCapabilities — capabilities без версии 1, ciphersuite 0x0001 или Basic credential.
	ErrKeyPackageCapabilities = errors.New("mlswire: capabilities KeyPackage не подходят группе")
	// ErrKeyPackageExtensions — расширение листа недопустимо в листе или не указано в capabilities.
	ErrKeyPackageExtensions = errors.New("mlswire: расширения листа KeyPackage недопустимы")
)

// checkLeafExtensions повторяет проверку openmls 0.9.2 (`LeafNode::validate_locally`,
// valn1601): в листе нельзя ratchet_tree, required_capabilities, external_pub,
// external_senders и last_resort, а каждый тип, кроме стандартных 0x0001–0x0005, обязан быть
// в capabilities.extensions. openmls проверяет это только при сборке commit-а, а не при приёме
// Add, — без этой проверки один пакет с неперечисленным расширением выбивал бы при commit-е
// всю пачку (ревью, раунд 3, П1).
func checkLeafExtensions(exts, supported []byte) error {
	r := newReader(exts)
	for r.remaining() > 0 {
		t, err := r.u16()
		if err != nil {
			return err
		}
		if _, err = r.vector(); err != nil {
			return err
		}
		switch {
		case t >= 0x0002 && t <= 0x0005, t == 0x000a:
			return ErrKeyPackageExtensions
		case t != 0x0001 && !hasU16(supported, t):
			return ErrKeyPackageExtensions
		}
	}
	return nil
}

// hasU16 — есть ли значение в векторе uint16 (capabilities).
func hasU16(v []byte, want uint16) bool {
	if len(v)%2 != 0 {
		return false
	}
	for i := 0; i < len(v); i += 2 {
		if uint16(v[i])<<8|uint16(v[i+1]) == want {
			return true
		}
	}
	return false
}

// KeyPackage — поля, которые DS проверяет и хранит. Подписи проверяются при разборе.
type KeyPackage struct {
	Ciphersuite   uint16
	InitKey       []byte // X25519, 32 байта; уникален среди всех пакетов
	EncryptionKey []byte // X25519, 32 байта; уникален среди всех пакетов и листьев
	SignatureKey  []byte // Ed25519, 32 байта: привязка к устройству
	Identity      []byte // Basic credential identity
	NotBefore     uint64
	NotAfter      uint64
	// Ref — KeyPackageRef (RFC 9420 §5.2): по нему Welcome адресован устройству.
	Ref []byte
}

// KeyPackagePolicy — ограничения DS на принимаемые KeyPackage.
type KeyPackagePolicy struct {
	Now time.Time
	// MaxLifetime — верхняя граница not_after − now (RFC 9420 §7.2 разрешает DS отвергать
	// слишком долгоживущие пакеты; без неё пакет «на 100 лет» принимается, риск 3 из S1).
	MaxLifetime time.Duration
	// ClockSkew — допуск на расхождение часов для not_before.
	ClockSkew time.Duration
}

const (
	labelKeyPackageTBS = "KeyPackageTBS"
	labelLeafNodeTBS   = "LeafNodeTBS"
	labelKeyPackageRef = "MLS 1.0 KeyPackage Reference"
)

// ParseKeyPackage разбирает KeyPackage (без обёртки MLSMessage), проверяет обе подписи,
// версию, ciphersuite 0x0001, Basic credential и срок действия.
func ParseKeyPackage(raw []byte, p KeyPackagePolicy) (KeyPackage, error) {
	r := newReader(raw)
	version, err := r.u16()
	if err != nil {
		return KeyPackage{}, err
	}
	cs, err := r.u16()
	if err != nil {
		return KeyPackage{}, err
	}
	if version != VersionMLS10 || cs != CiphersuiteX25519AES128Ed25519 {
		return KeyPackage{}, ErrUnsupported
	}
	initKey, err := r.vector()
	if err != nil {
		return KeyPackage{}, err
	}
	leafStart := r.off
	encKey, err := r.vector()
	if err != nil {
		return KeyPackage{}, err
	}
	sigKey, err := r.vector()
	if err != nil {
		return KeyPackage{}, err
	}
	if len(initKey) != 32 || len(encKey) != 32 || len(sigKey) != ed25519.PublicKeySize ||
		bytes.Equal(initKey, encKey) {
		return KeyPackage{}, ErrKeyPackageKeys
	}
	credType, err := r.u16()
	if err != nil {
		return KeyPackage{}, err
	}
	if credType != CredentialBasic {
		return KeyPackage{}, ErrUnsupported
	}
	identity, err := r.vector()
	if err != nil {
		return KeyPackage{}, err
	}
	// Capabilities: versions, cipher_suites, extensions, proposals, credentials. Без версии 1,
	// ciphersuite 0x0001 и Basic credential участник не сможет закоммитить Add (openmls
	// отвергнет его при сборке commit-а), поэтому такой пакет отвергается ещё здесь.
	var caps [5][]byte
	for i := range caps {
		if caps[i], err = r.vector(); err != nil {
			return KeyPackage{}, err
		}
	}
	if !hasU16(caps[0], VersionMLS10) || !hasU16(caps[1], CiphersuiteX25519AES128Ed25519) ||
		!hasU16(caps[4], CredentialBasic) {
		return KeyPackage{}, ErrKeyPackageCapabilities
	}
	source, err := r.u8()
	if err != nil {
		return KeyPackage{}, err
	}
	if source != LeafSourceKeyPackage {
		return KeyPackage{}, ErrUnsupported
	}
	notBefore, err := r.u64()
	if err != nil {
		return KeyPackage{}, err
	}
	notAfter, err := r.u64()
	if err != nil {
		return KeyPackage{}, err
	}
	leafExt, err := r.vector() // LeafNode.extensions
	if err != nil {
		return KeyPackage{}, err
	}
	if err = checkLeafExtensions(leafExt, caps[2]); err != nil {
		return KeyPackage{}, err
	}
	leafTBS := raw[leafStart:r.off]
	leafSig, err := r.vector()
	if err != nil {
		return KeyPackage{}, err
	}
	if _, err = r.vector(); err != nil { // KeyPackage.extensions
		return KeyPackage{}, err
	}
	kpTBS := raw[:r.off]
	kpSig, err := r.vector()
	if err != nil {
		return KeyPackage{}, err
	}
	if err = r.end(); err != nil {
		return KeyPackage{}, err
	}
	if !verifyWithLabel(sigKey, labelLeafNodeTBS, leafTBS, leafSig) ||
		!verifyWithLabel(sigKey, labelKeyPackageTBS, kpTBS, kpSig) {
		return KeyPackage{}, ErrKeyPackageSignature
	}
	now := p.Now.Unix()
	if int64(notBefore) > now+int64(p.ClockSkew/time.Second) || //nolint:gosec // время в секундах
		int64(notAfter) < now || //nolint:gosec
		int64(notAfter) > now+int64(p.MaxLifetime/time.Second) || //nolint:gosec
		notAfter < notBefore {
		return KeyPackage{}, ErrKeyPackageLifetime
	}
	return KeyPackage{
		Ciphersuite:   cs,
		InitKey:       bytes.Clone(initKey),
		EncryptionKey: bytes.Clone(encKey),
		SignatureKey:  bytes.Clone(sigKey),
		Identity:      bytes.Clone(identity),
		NotBefore:     notBefore,
		NotAfter:      notAfter,
		Ref:           refHash(labelKeyPackageRef, raw),
	}, nil
}

// signContent — SignContent из RFC 9420 §5.1.2: {opaque label<V>; opaque content<V>}.
func signContent(label string, content []byte) []byte {
	var w writer
	w.vector([]byte("MLS 1.0 " + label))
	w.vector(content)
	return w.b
}

func verifyWithLabel(pub []byte, label string, content, sig []byte) bool {
	return ed25519.Verify(ed25519.PublicKey(pub), signContent(label, content), sig)
}

func signWithLabel(priv ed25519.PrivateKey, label string, content []byte) []byte {
	return ed25519.Sign(priv, signContent(label, content))
}

// refHash — RefHash(label, value) = SHA-256(RefHashInput{label<V>, value<V>}) для ciphersuite 0x0001.
func refHash(label string, value []byte) []byte {
	var w writer
	w.vector([]byte(label))
	w.vector(value)
	sum := sha256.Sum256(w.b)
	return sum[:]
}

// KeyPackageParams — параметры для BuildKeyPackage (тесты и эмулятор нагрузки).
type KeyPackageParams struct {
	Signer        ed25519.PrivateKey
	Identity      []byte
	InitKey       []byte // 32 байта X25519
	EncryptionKey []byte // 32 байта X25519
	NotBefore     time.Time
	NotAfter      time.Time
	// CipherSuites — вектор capabilities.cipher_suites; пусто — [0x0001].
	CipherSuites []byte
	// LeafExtensions — готовый вектор расширений листа (тесты), CapExtensions — capabilities.extensions.
	LeafExtensions []byte
	CapExtensions  []byte
}

// BuildKeyPackage собирает подписанный KeyPackage. Нужен только эмулятору клиентов и тестам
// DS: настоящие клиенты создают KeyPackage в crypto-core.
func BuildKeyPackage(p KeyPackageParams) []byte {
	var leaf writer
	leaf.vector(p.EncryptionKey)
	leaf.vector(p.Signer.Public().(ed25519.PublicKey))
	leaf.u16(CredentialBasic)
	leaf.vector(p.Identity)
	// Capabilities: versions [1], cipher_suites [1], extensions [], proposals [], credentials [1].
	cs := p.CipherSuites
	if cs == nil {
		cs = []byte{0, 1}
	}
	leaf.vector([]byte{0, 1})
	leaf.vector(cs)
	leaf.vector(p.CapExtensions)
	leaf.vector(nil)
	leaf.vector([]byte{0, 1})
	leaf.u8(LeafSourceKeyPackage)
	leaf.u64(uint64(p.NotBefore.Unix())) //nolint:gosec // время после 1970
	leaf.u64(uint64(p.NotAfter.Unix()))  //nolint:gosec
	leaf.vector(p.LeafExtensions)
	leafSig := signWithLabel(p.Signer, labelLeafNodeTBS, leaf.b)
	leaf.vector(leafSig)

	var kp writer
	kp.u16(VersionMLS10)
	kp.u16(CiphersuiteX25519AES128Ed25519)
	kp.vector(p.InitKey)
	kp.raw(leaf.b)
	kp.vector(nil)
	kpSig := signWithLabel(p.Signer, labelKeyPackageTBS, kp.b)
	kp.vector(kpSig)
	return kp.b
}
