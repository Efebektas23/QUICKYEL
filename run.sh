#!/bin/bash

# QuickYel - Run Script
# Google Native Stack

echo "=============================================="
echo "🚀 QuickYel - Expense Automation Platform"
echo "   Google Native Stack"
echo "   Project: muhtar-5ab9b"
echo "=============================================="

# Check if virtual environment exists
if [ ! -d "backend/venv" ]; then
    echo ""
    echo "📦 Setting up Python virtual environment..."
    cd backend
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    cd ..
else
    source backend/venv/bin/activate
fi

# Run setup checks
echo ""
echo "🔍 Running setup checks..."
cd backend
python scripts/setup_demo.py
SETUP_STATUS=$?
cd ..

if [ $SETUP_STATUS -ne 0 ]; then
    echo ""
    echo "❌ Setup checks failed. Please fix the errors above."
    exit 1
fi

# Start backend
echo ""
echo "🖥️ Starting QuickYel Backend..."
echo "   API: http://localhost:8000"
echo "   Docs: http://localhost:8000/docs"
echo ""

cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000

