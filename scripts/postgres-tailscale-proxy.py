#!/usr/bin/env python3
"""Relay Tailscale-bound TCP to local Postgres loopback (no SSH tunnel from peers)."""

from __future__ import annotations

import argparse
import socket
import threading


def forward(src: socket.socket, dst: socket.socket) -> None:
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def harden(sock: socket.socket) -> None:
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)


def handle(client: socket.socket, upstream_host: str, upstream_port: int) -> None:
    harden(client)
    try:
        upstream = socket.create_connection((upstream_host, upstream_port), timeout=10)
    except OSError:
        client.close()
        return
    harden(upstream)
    try:
        t1 = threading.Thread(target=forward, args=(client, upstream), daemon=True)
        t1.start()
        forward(upstream, client)
        t1.join(timeout=5)
    finally:
        for sock in (client, upstream):
            try:
                sock.close()
            except OSError:
                pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--listen-host", default="100.77.131.28")
    parser.add_argument("--listen-port", type=int, default=5432)
    parser.add_argument("--upstream-host", default="127.0.0.1")
    parser.add_argument("--upstream-port", type=int, default=5432)
    args = parser.parse_args()

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((args.listen_host, args.listen_port))
    server.listen(64)
    print(
        f"athere-postgres-tailscale-proxy listening on {args.listen_host}:{args.listen_port} "
        f"-> {args.upstream_host}:{args.upstream_port}",
        flush=True,
    )
    while True:
        client, _addr = server.accept()
        threading.Thread(
            target=handle,
            args=(client, args.upstream_host, args.upstream_port),
            daemon=True,
        ).start()


if __name__ == "__main__":
    main()
