import os
from celery import Celery
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Retrieve the secure Redis URL from your .env file
redis_url = os.getenv("REDIS_URL")

# Initialize Celery app
# 'tasks' refers to the tasks.py file we will create in the next step
celery_app = Celery(
    "study_assistant_worker",
    broker=redis_url,
    backend=redis_url,
    include=["tasks"]
)

# Custom configuration to handle Upstash's secure SSL protocol smoothly on Windows/Linux
celery_app.conf.update(
    broker_use_ssl={"ssl_cert_reqs": 0},  # 0 matches CERT_NONE for secure routing
    redis_backend_use_ssl={"ssl_cert_reqs": 0},
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

print("🚀 Celery application configured successfully with Upstash Redis!")
