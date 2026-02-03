FROM python:3.12-slim

WORKDIR /app/sidecar

COPY sidecar/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY sidecar/*.py ./
COPY vendor /app/vendor

ENV AULA_SIDECAR_PORT=5042
EXPOSE 5042

CMD ["python", "app.py"]
