"""
本地 HTTP CONNECT 代理：把所有出站流量绑定到 WireGuard 隧道网卡。
用途：让 git（不支持 --interface）也能走 VPN 隧道访问 GitHub。

用法：
    python net-bridge.py <隧道网卡IP> <监听端口>
例：
    python net-bridge.py 192.168.133.2 7899
然后：
    git config --global http.proxy http://127.0.0.1:7899
"""
import socket
import sys
import threading

BIND_IP = sys.argv[1] if len(sys.argv) > 1 else '192.168.133.2'
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 7899
BUFSIZE = 65536


def pipe(src, dst):
    try:
        while True:
            data = src.recv(BUFSIZE)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                s.close()
            except OSError:
                pass


def handle(client, addr, bind_ip):
    """处理一个 CONNECT 请求"""
    try:
        client.settimeout(30)
        # 读取请求头（CONNECT host:port HTTP/1.1 ...）
        buf = b''
        while b'\r\n\r\n' not in buf:
            chunk = client.recv(4096)
            if not chunk:
                client.close()
                return
            buf += chunk
            if len(buf) > 65536:
                client.close()
                return

        head = buf.split(b'\r\n\r\n', 1)[0].decode('latin-1')
        lines = head.split('\r\n')
        first = lines[0].split()
        if len(first) < 2 or first[0].upper() != 'CONNECT':
            client.close()
            return

        hostport = first[1]
        if ':' in hostport:
            host, port = hostport.rsplit(':', 1)
            port = int(port)
        else:
            host, port = hostport, 443

        # 关键：出站 socket 绑定到隧道网卡
        upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        upstream.settimeout(30)
        upstream.bind((bind_ip, 0))
        upstream.connect((host, port))
        upstream.settimeout(None)

        client.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
        client.settimeout(None)

        t = threading.Thread(target=pipe, args=(client, upstream), daemon=True)
        t.start()
        pipe(upstream, client)
    except Exception as exc:
        try:
            client.sendall(b'HTTP/1.1 502 Bad Gateway\r\n\r\n')
        except OSError:
            pass
        try:
            client.close()
        except OSError:
            pass
        print('  [!] %s -> %s' % (addr, exc), flush=True)


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(('127.0.0.1', PORT))
    srv.listen(64)
    print('net-bridge 已启动: 127.0.0.1:%d  出站绑定 %s' % (PORT, BIND_IP), flush=True)
    while True:
        try:
            client, addr = srv.accept()
        except OSError:
            break
        threading.Thread(target=handle, args=(client, addr, BIND_IP), daemon=True).start()


if __name__ == '__main__':
    main()
