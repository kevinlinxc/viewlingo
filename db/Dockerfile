FROM python:3.11-slim

WORKDIR /app

# Copy requirements first for better caching
RUN pip install uv
COPY requirements.txt .
RUN uv pip install --system --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]