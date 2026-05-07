#!/bin/bash
# ──────────────────────────────────────────────────────
# Local 7B Model Pool Setup Script
#
# Pulls 5 diverse 7B-class models into Ollama and
# generates the .env configuration for multi-model mode.
#
# Prerequisites:
#   - Ollama installed (https://ollama.ai)
#   - At least 24GB VRAM for 2-3 concurrent models
#     or 48GB+ for all 5 (quantized)
#   - ~25GB disk space for model weights
#
# Usage:
#   chmod +x scripts/local-models-setup.sh
#   ./scripts/local-models-setup.sh
# ──────────────────────────────────────────────────────

set -e

echo "═══════════════════════════════════════"
echo "  What-If: Local Model Pool Setup"
echo "═══════════════════════════════════════"
echo ""

# Model pool definition
MODELS=(
    "qwen2.5:7b"       # 阿里通义千问 — 强中文理解
    "llama3.1:8b"       # Meta LLaMA — 强推理
    "mistral:7b"        # Mistral AI — 强欧洲视角
    "yi:6b"             # 零一万物 — 强中文+创造力
    "gemma2:9b"         # Google DeepMind — 强事实性
)

# Check Ollama is installed
if ! command -v ollama &> /dev/null; then
    echo "❌ Ollama not found. Install from https://ollama.ai"
    exit 1
fi

# Check Ollama is running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "⚠️  Ollama not running. Starting..."
    ollama serve &
    sleep 3
    if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo "❌ Failed to start Ollama."
        exit 1
    fi
fi

echo "✅ Ollama is running"
echo ""

# Pull each model
POOL_STR=""
for model in "${MODELS[@]}"; do
    echo "── Pulling ${model}..."
    if ollama list | grep -q "$(echo $model | cut -d: -f1)"; then
        echo "   Already present, skipping."
    else
        ollama pull "$model"
    fi

    if [ -n "$POOL_STR" ]; then
        POOL_STR="${POOL_STR},${model}"
    else
        POOL_STR="${model}"
    fi
    echo ""
done

echo "═══════════════════════════════════════"
echo "  All models ready!"
echo "═══════════════════════════════════════"
echo ""
echo "Pool: ${POOL_STR}"
echo ""

# Generate / update .env
ENV_FILE="$(dirname "$0")/../backend/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "Creating .env from .env.example..."
    cp "$(dirname "$0")/../backend/.env.example" "$ENV_FILE"
fi

# Check if Ollama config already exists
if grep -q "WHATIF_OLLAMA_BASE_URL" "$ENV_FILE"; then
    echo "Ollama config already in .env — updating model pool..."
    # Use portable sed (works on both macOS and Linux)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^WHATIF_OLLAMA_MODEL_POOL=.*|WHATIF_OLLAMA_MODEL_POOL=${POOL_STR}|" "$ENV_FILE"
    else
        sed -i "s|^WHATIF_OLLAMA_MODEL_POOL=.*|WHATIF_OLLAMA_MODEL_POOL=${POOL_STR}|" "$ENV_FILE"
    fi
else
    echo "Adding Ollama config to .env..."
    cat >> "$ENV_FILE" << EOF

# ─── Local Model Pool (auto-generated) ────────────
WHATIF_OLLAMA_BASE_URL=http://localhost:11434
WHATIF_OLLAMA_MODEL=${MODELS[0]}
WHATIF_OLLAMA_MODEL_POOL=${POOL_STR}
WHATIF_STRONG_BACKEND_OVERRIDE=ollama
WHATIF_AUTO_LOOP_MAX_CYCLES=10
WHATIF_AUTO_LOOP_PAUSE_SECONDS=5.0
EOF
fi

echo ""
echo "═══════════════════════════════════════"
echo "  Configuration written to backend/.env"
echo "═══════════════════════════════════════"
echo ""
echo "To start the experiment:"
echo "  cd backend && uvicorn app.main:app --reload"
echo ""
echo "Then use the auto-loop API:"
echo "  curl -N http://localhost:8000/api/orchestrator/auto-loop \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"event_id\":\"haber_process\",\"seed_hypothesis\":\"如果哈伯工艺效率提高5倍\",\"max_cycles\":5}'"
echo ""
echo "Or open the UI at http://localhost:5173"
echo "  → 闭环推演 tab → (future: auto-loop UI)"
echo ""
