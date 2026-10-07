FROM python:3.11-slim

WORKDIR /app

# Instalacja zależności systemowych
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY database.py .
COPY backend_mqtt.py .
COPY backend_native.py .
COPY static ./static

EXPOSE 8000

ENV SQLITE_DB_PATH=/data/telemetry.db
ENV PORT=8000

CMD ["python", "backend_mqtt.py"]
