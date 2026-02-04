import time
import requests

def wait_for_ollama(base_url: str, model: str, timeout_sec: int = 300):
    """
    base_url: e.g. http://ollama:11434
    """
    deadline = time.time() + timeout_sec
    tags_url = f"{base_url.rstrip('/')}/api/tags"

    last_err = None
    while time.time() < deadline:
        try:
            r = requests.get(tags_url, timeout=2)
            r.raise_for_status()
            models = [m.get("name") for m in r.json().get("models", [])]
            if any((m or "").startswith(model) for m in models):
                return True
            # model not present yet
        except Exception as e:
            last_err = str(e)

        time.sleep(2)

    raise RuntimeError(f"Ollama not ready or model '{model}' missing. Last error: {last_err}")
