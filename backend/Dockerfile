FROM python:3.12-slim

WORKDIR /app

# Needed for chroma-hnswlib / other native wheels (build from source fallback)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
  && pip install --no-cache-dir "pydevd-pycharm~=253.30387.90"

RUN apt-get update && apt-get install -y --no-install-recommends \
  git ripgrep \
  && rm -rf /var/lib/apt/lists/*


COPY app ./app
ENV PYTHONPATH=/app

EXPOSE 8080
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]

