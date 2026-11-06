// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package buildinfo

import (
	"runtime/debug"
	"testing"
)

func TestFromBuildInfo(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		info *debug.BuildInfo
		ok   bool
		want string
	}{
		{name: "нет сведений", info: nil, ok: false, want: "dev"},
		{name: "версия модуля", info: &debug.BuildInfo{Main: debug.Module{Version: "v1.2.3"}}, ok: true, want: "v1.2.3"},
		{name: "devel без VCS", info: &debug.BuildInfo{Main: debug.Module{Version: "(devel)"}}, ok: true, want: "dev"},
		{
			name: "ревизия VCS",
			info: &debug.BuildInfo{Main: debug.Module{Version: "(devel)"}, Settings: []debug.BuildSetting{
				{Key: "vcs.revision", Value: "0123456789abcdef0123"},
				{Key: "vcs.modified", Value: "false"},
			}},
			ok:   true,
			want: "dev-0123456789ab",
		},
		{
			name: "ревизия с локальными правками",
			info: &debug.BuildInfo{Settings: []debug.BuildSetting{
				{Key: "vcs.revision", Value: "abcdef"},
				{Key: "vcs.modified", Value: "true"},
			}},
			ok:   true,
			want: "dev-abcdef-dirty",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := fromBuildInfo(tt.info, tt.ok); got != tt.want {
				t.Errorf("fromBuildInfo() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestVersionNotEmpty(t *testing.T) {
	t.Parallel()
	if Version() == "" {
		t.Fatal("Version() пустая")
	}
}
