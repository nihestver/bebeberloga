// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package buildinfo отдаёт версию сервера: её задаёт сборка через
// `-ldflags "-X github.com/nihestver/bebeberloga/server/internal/buildinfo.version=v1.2.3"`,
// а без неё — ревизия VCS из сведений о сборке Go или «dev».
package buildinfo

import (
	"runtime/debug"
	"sync"
)

// version задаётся при сборке; пустая строка означает «не задана».
var version string

// Version возвращает версию сервера. Значение вычисляется один раз.
var Version = sync.OnceValue(func() string {
	if version != "" {
		return version
	}
	return fromBuildInfo(debug.ReadBuildInfo())
})

// fromBuildInfo выводит версию из сведений о сборке: версия модуля, если она
// не псевдоверсия `(devel)`, иначе короткая ревизия VCS с пометкой о локальных правках.
func fromBuildInfo(info *debug.BuildInfo, ok bool) string {
	if !ok || info == nil {
		return "dev"
	}
	if v := info.Main.Version; v != "" && v != "(devel)" {
		return v
	}
	var rev string
	modified := false
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			rev = s.Value
		case "vcs.modified":
			modified = s.Value == "true"
		}
	}
	if rev == "" {
		return "dev"
	}
	if len(rev) > 12 {
		rev = rev[:12]
	}
	if modified {
		return "dev-" + rev + "-dirty"
	}
	return "dev-" + rev
}
