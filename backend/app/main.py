"""FastAPI application entry point for What-If Simulation Platform."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.routers import debate

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    description="AI-powered macro scenario simulation platform",
    version="0.1.0",
)

# CORS middleware for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(debate.router)

# Future: uncomment as modules are built
# from app.routers import causal, counterfactual
# app.include_router(causal.router)
# app.include_router(counterfactual.router)


@app.get("/")
async def root():
    return {
        "name": settings.app_name,
        "version": "0.1.0",
        "modules": {
            "debate_room": "active",
            "causal_graph": "coming_soon",
            "counterfactual": "coming_soon",
        },
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
