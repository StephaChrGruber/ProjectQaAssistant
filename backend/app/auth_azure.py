import time
import requests
import jwt
from jwt import PyJWKClient
from fastapi import HTTPException, status
from .settings import settings

_jwks_client: PyJWKClient | None = None
_last_init = 0

def _get_jwks_client() -> PyJWKClient:
    global _jwks_client, _last_init
    # Refresh JWKS URL periodically (tenant key rollover)
    if _jwks_client and (time.time() - _last_init) < 3600:
        return _jwks_client

    # Standard OIDC metadata
    meta_url = f"https://login.microsoftonline.com/{settings.AZURE_TENANT_ID}/v2.0/.well-known/openid-configuration"
    meta = requests.get(meta_url, timeout=20).json()
    jwks_uri = meta["jwks_uri"]

    _jwks_client = PyJWKClient(jwks_uri)
    _last_init = time.time()
    return _jwks_client

def verify_bearer_token(token: str) -> dict:
    try:
        jwks_client = _get_jwks_client()
        signing_key = jwks_client.get_signing_key_from_jwt(token).key
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=settings.AZURE_AUDIENCE,
            issuer=settings.AZURE_ISSUER,
        )
        return payload
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        )
