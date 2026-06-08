#!/usr/bin/env python3
"""
TLS 终止中继: 监听 :443, 剥离 TLS 后转发到 codex-relay (:4446)
"""
import socket, ssl, threading, select

RELAY_HOST = "127.0.0.1"
RELAY_PORT = 4446
CERT = "/tmp/cert.pem"
KEY = "/tmp/key.pem"

def pipe(a, b):
    try:
        while True:
            r, _, _ = select.select([a, b], [], [], 30)
            if not r: break
            for s in r:
                d = s.recv(65536)
                if not d: return
                (b if s is a else a).sendall(d)
    except: pass

def handle(client_sock, addr):
    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        tls_conn = ctx.wrap_socket(client_sock, server_side=True)

        relay = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        relay.settimeout(30)
        relay.connect((RELAY_HOST, RELAY_PORT))
        pipe(tls_conn, relay)
        relay.close()
    except: pass
    finally:
        try: client_sock.close()
        except: pass

def main():
    s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    s.bind(("::", 443))
    s.listen(50)
    print("[TLS→Relay] Listening :443 → :4446", flush=True)

    while True:
        c, a = s.accept()
        threading.Thread(target=handle, args=(c, a), daemon=True).start()

if __name__ == "__main__":
    main()
