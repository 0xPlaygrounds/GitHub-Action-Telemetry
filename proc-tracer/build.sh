#!/usr/bin/env bash
# Builds proc-tracer for the CPU architecture of this machine into the given output file.
# On a machine whose architecture differs from the committed vmlinux.h (x86-64), set
# REGENERATE_VMLINUX=1 to dump the kernel's own BTF types first; this needs bpftool.
set -euo pipefail
output=$(realpath -m "$1")
cd "$(dirname "$0")"
if [[ ${REGENERATE_VMLINUX:-} == 1 ]]; then
  bpftool btf dump file /sys/kernel/btf/vmlinux format c >vmlinux.h
fi
# proc-tracer.c includes <asm/types.h>, which Debian and Ubuntu keep in a per-architecture folder.
BPF2GO_CFLAGS="-I/usr/include/$(uname -m)-linux-gnu"
export BPF2GO_CFLAGS
go generate ./...
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w -buildid=' -o "$output" .
