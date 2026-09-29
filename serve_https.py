"""Serveur HTTPS local pour l'assistant vocal Astra — permet le micro sur mobile.

Pourquoi : sur telephone, le navigateur BLOQUE le micro en HTTP (contexte non
securise). Il faut HTTPS (ou localhost). Ce script sert l'app en HTTPS avec un
certificat auto-signe.

Usage :
    python serve_https.py [port]     (defaut : 8443)

Sur le telephone (meme reseau Wi-Fi) :
    https://<IP-DU-PC>:8443/index.html
    -> accepter l'avertissement de certificat (Avance / Accepter le risque)

Le certificat est genere automatiquement (openssl) dans certs/ au premier lancement.
"""
import http.server
import os
import socket
import ssl
import subprocess
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
BASE = os.path.dirname(os.path.abspath(__file__))
CERTS = os.path.join(BASE, "certs")
CERT = os.path.join(CERTS, "cert.pem")
KEY = os.path.join(CERTS, "key.pem")


def ensure_cert():
    if os.path.exists(CERT) and os.path.exists(KEY):
        return
    os.makedirs(CERTS, exist_ok=True)
    openssl = None
    for cand in (r"C:\Program Files\Git\usr\bin\openssl.exe", "openssl"):
        try:
            subprocess.run([cand, "version"], capture_output=True, check=True)
            openssl = cand
            break
        except Exception:
            continue
    if not openssl:
        print("openssl introuvable - installe Git for Windows ou genere cert.pem/key.pem dans certs/")
        sys.exit(1)
    subprocess.run(
        [openssl, "req", "-x509", "-newkey", "rsa:2048",
         "-keyout", KEY, "-out", CERT, "-days", "365", "-nodes",
         "-subj", "/CN=localhost"],
        check=True, capture_output=True,
    )
    print("Certificat auto-signe genere dans certs/")


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


ensure_cert()
handler = http.server.SimpleHTTPRequestHandler
handler.directory = BASE
httpd = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(CERT, KEY)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
ip = lan_ip()
print(f"Astra HTTPS : https://{ip}:{PORT}/index.html")
print(f"  -> sur le telephone, accepte le certificat (Avance / Accepter le risque)")
print(f"Local      : https://127.0.0.1:{PORT}/index.html")
httpd.serve_forever()