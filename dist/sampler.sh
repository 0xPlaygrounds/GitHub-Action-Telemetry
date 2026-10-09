#!/usr/bin/env bash
# Appends one JSON line of raw counters per interval; the post step turns them into usage figures.
file=$1
interval=${2:-5}
workspace=${GITHUB_WORKSPACE:-/}

# Physical disks and network interfaces only, so loop devices, device-mapper volumes, and
# container bridges do not count the same bytes twice. Inside a container, where no device is
# physical, all devices except virtual block devices and lo are counted.
disks=()
for device in /sys/block/*; do
  [[ -e $device/device ]] && disks+=("${device##*/}")
done
if ((${#disks[@]} == 0)); then
  for device in /sys/block/*; do
    case ${device##*/} in loop* | ram* | zram* | dm-* | nbd*) ;; *) disks+=("${device##*/}") ;; esac
  done
fi
interfaces=()
for device in /sys/class/net/*; do
  [[ -e $device/device ]] && interfaces+=("${device##*/}")
done
if ((${#interfaces[@]} == 0)); then
  for device in /sys/class/net/*; do
    [[ ${device##*/} != lo ]] && interfaces+=("${device##*/}")
  done
fi

is_listed() {
  local name=$1
  shift
  local item
  for item in "$@"; do [[ $item == "$name" ]] && return 0; done
  return 1
}

while true; do
  read -r _ user nice system idle iowait irq softirq steal _ </proc/stat
  while read -r key value _; do
    case $key in
      MemTotal:) mem_total=$value ;;
      MemAvailable:) mem_available=$value ;;
      SwapTotal:) swap_total=$value ;;
      SwapFree:) swap_free=$value ;;
    esac
  done </proc/meminfo
  read -r load1 _ </proc/loadavg

  disk_free=
  while read -r avail; do
    if [[ -z $disk_free || $avail -lt $disk_free ]]; then disk_free=$avail; fi
  done < <(df -B1 --output=avail / "$workspace" | tail -n +2)
  read -r disk_used < <(df -B1 --output=used "$workspace" | tail -n +2)

  disk_read=0
  disk_write=0
  while read -r _ _ name _ _ read_sectors _ _ _ write_sectors _; do
    if is_listed "$name" "${disks[@]}"; then
      disk_read=$((disk_read + read_sectors * 512))
      disk_write=$((disk_write + write_sectors * 512))
    fi
  done </proc/diskstats

  net_rx=0
  net_tx=0
  while read -r line; do
    name=${line%%:*}
    name=${name// /}
    if is_listed "$name" "${interfaces[@]}"; then
      read -r rx _ _ _ _ _ _ _ tx _ <<<"${line#*:}"
      net_rx=$((net_rx + rx))
      net_tx=$((net_tx + tx))
    fi
  done < <(tail -n +3 /proc/net/dev)

  now=${EPOCHREALTIME/./}
  printf '{"t":%s,"user":%s,"system":%s,"idle":%s,"iowait":%s,"mem_used":%s,"swap_used":%s,"load1":%s,"disk_free":%s,"disk_used":%s,"disk_read":%s,"disk_write":%s,"net_rx":%s,"net_tx":%s}\n' \
    "${now:0:13}" \
    "$((user + nice))" "$((system + irq + softirq + steal))" "$idle" "$iowait" \
    "$(((mem_total - mem_available) * 1024))" "$(((swap_total - swap_free) * 1024))" \
    "$load1" "$disk_free" "$disk_used" "$disk_read" "$disk_write" "$net_rx" "$net_tx" >>"$file"
  sleep "$interval"
done
