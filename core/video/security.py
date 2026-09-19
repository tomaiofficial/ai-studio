"""
core/video/security.py — Sécurité et protection (v8.0)

Protection contre les abus :
  - Validation des prompts (filtrage contenu, limite de longueur)
  - Validation des uploads (type MIME, taille, dimensions)
  - Protection DDoS (rate limiting par IP)
  - Logs de sécurité structurés
  - Sanitisation des entrées

Usage::

    from core.video.security import SecurityValidator

    validator = SecurityValidator()
    if not validator.validate_prompt(prompt):
        raise HTTPException(400, "Prompt invalide")
"""

from __future__ import annotations

import hashlib
import ipaddress
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# Limites de sécurité
MAX_PROMPT_LENGTH = 5000
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
ALLOWED_VIDEO_MIMES = {"video/mp4", "video/webm", "video/quicktime"}
MAX_IMAGE_DIMENSION = 4096  # 4K max

# Mots-bloqués (contenu inapproprié)
BLOCKED_PATTERNS = [
    r"(?i)\b(sex|porn|nude|xxx)\b",
    r"(?i)\b(violen|kill|murder|death)\b",
    r"(?i)\b(illegal|drugs|cocaine|heroin)\b",
]

# Rate limiting par IP (DDoS protection)
_IP_RATE_LIMIT: dict[str, list[float]] = {}
_IP_RATE_WINDOW = 60  # 60 secondes
_IP_RATE_MAX_REQUESTS = 30  # max 30 requêtes/minute par IP


@dataclass
class ValidationResult:
    """Résultat de validation."""
    valid: bool
    error: Optional[str] = None
    sanitized: Optional[str] = None
    warnings: list = field(default_factory=list)


class SecurityValidator:
    """Validateur de sécurité pour les entrées utilisateur."""

    def __init__(self):
        self.max_prompt_length = MAX_PROMPT_LENGTH
        self.max_upload_size = MAX_UPLOAD_SIZE

    def validate_prompt(self, prompt: str) -> ValidationResult:
        """Valide un prompt utilisateur.

        Args:
            prompt: Le prompt à valider.

        Returns:
            ValidationResult avec le statut et le prompt sanitisé.
        """
        if not prompt or not prompt.strip():
            return ValidationResult(valid=False, error="Prompt vide")

        if len(prompt) > self.max_prompt_length:
            return ValidationResult(
                valid=False,
                error=f"Prompt trop long ({len(prompt)} > {self.max_prompt_length} caractères)"
            )

        # Vérifier les mots-bloqués
        for pattern in BLOCKED_PATTERNS:
            if re.search(pattern, prompt):
                return ValidationResult(
                    valid=False,
                    error="Le prompt contient du contenu bloqué"
                )

        # Sanitiser : enlever les caractères de contrôle
        sanitized = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', prompt)

        return ValidationResult(valid=True, sanitized=sanitized)

    def validate_upload(
        self,
        filename: str,
        content_type: str,
        file_size: int,
        width: Optional[int] = None,
        height: Optional[int] = None,
    ) -> ValidationResult:
        """Valide un fichier uploadé.

        Args:
            filename: Nom du fichier.
            content_type: Type MIME.
            file_size: Taille en octets.
            width: Largeur (pour les images).
            height: Hauteur (pour les images).

        Returns:
            ValidationResult.
        """
        if not filename:
            return ValidationResult(valid=False, error="Nom de fichier vide")

        if file_size > self.max_upload_size:
            return ValidationResult(
                valid=False,
                error=f"Fichier trop grand ({file_size} > {self.max_upload_size} octets)"
            )

        # Vérifier l'extension
        ext = os.path.splitext(filename)[1].lower()
        if ext not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov"}:
            return ValidationResult(
                valid=False,
                error=f"Extension non autorisée: {ext}"
            )

        # Vérifier le type MIME
        if content_type not in ALLOWED_IMAGE_MIMES and content_type not in ALLOWED_VIDEO_MIMES:
            return ValidationResult(
                valid=False,
                error=f"Type MIME non autorisé: {content_type}"
            )

        # Vérifier les dimensions (images)
        if width and height:
            if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
                return ValidationResult(
                    valid=False,
                    error=f"Dimensions trop grandes: {width}x{height} (max {MAX_IMAGE_DIMENSION})"
                )

        return ValidationResult(valid=True)

    def check_ip_rate_limit(self, ip: str) -> bool:
        """Vérifie le rate limit par IP (protection DDoS).

        Args:
            ip: Adresse IP du client.

        Returns:
            True si la requête est autorisée, False si rate limité.
        """
        now = time.time()
        window_start = now - _IP_RATE_WINDOW

        # Nettoyer les anciennes entrées
        if ip in _IP_RATE_LIMIT:
            _IP_RATE_LIMIT[ip] = [t for t in _IP_RATE_LIMIT[ip] if t > window_start]
        else:
            _IP_RATE_LIMIT[ip] = []

        # Vérifier la limite
        if len(_IP_RATE_LIMIT[ip]) >= _IP_RATE_MAX_REQUESTS:
            logger.warning(f"[Security] Rate limit exceeded for IP {ip}")
            return False

        # Ajouter la requête actuelle
        _IP_RATE_LIMIT[ip].append(now)
        return True

    def sanitize_filename(self, filename: str) -> str:
        """Sanitise un nom de fichier (évite le path traversal).

        Args:
            filename: Nom de fichier original.

        Returns:
            Nom de fichier sanitisé.
        """
        # Enlever les chemins
        basename = os.path.basename(filename)
        # Enlever les caractères dangereux
        sanitized = re.sub(r'[^\w\.\-]', '_', basename)
        # Limiter la longueur
        if len(sanitized) > 255:
            name, ext = os.path.splitext(sanitized)
            sanitized = name[:255 - len(ext)] + ext
        return sanitized

    def hash_content(self, content: bytes) -> str:
        """Calcule le hash SHA256 du contenu (pour la déduplication)."""
        return hashlib.sha256(content).hexdigest()

    def log_security_event(
        self,
        event_type: str,
        ip: str = "",
        user_id: str = "",
        details: Optional[dict] = None,
    ) -> None:
        """Enregistre un événement de sécurité.

        Args:
            event_type: Type d'événement (rate_limit, blocked_prompt, etc.).
            ip: Adresse IP.
            user_id: ID utilisateur.
            details: Détails supplémentaires.
        """
        log_data = {
            "timestamp": time.time(),
            "event_type": event_type,
            "ip": ip,
            "user_id": user_id,
            "details": details or {},
        }
        logger.info(f"[Security] {event_type}: {log_data}")
