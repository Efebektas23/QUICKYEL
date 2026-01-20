# QuickYel - Expense Automation Platform

**Google Native Stack Edition**

A web-based expense management application for Canadian logistics companies operating in Canada and the USA. Built entirely on Google Cloud services for cost efficiency and data privacy.

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Backend       │────▶│   Database      │
│   (Next.js PWA) │     │   (FastAPI)     │     │   (PostgreSQL)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Google   │   │ Google   │   │ Bank of  │
        │ Vision   │   │ Gemini   │   │ Canada   │
        │ (OCR)    │   │ 1.5 Flash│   │ API      │
        └──────────┘   └──────────┘   └──────────┘
              │
              ▼
        ┌──────────┐
        │ Google   │
        │ Cloud    │
        │ Storage  │
        └──────────┘
```

## 🔧 Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 14 (PWA) |
| Backend | FastAPI (Python) |
| Database | PostgreSQL |
| OCR Engine | Google Cloud Vision API |
| AI Parser | Google Gemini 1.5 Flash |
| File Storage | Google Cloud Storage |
| Currency Data | Bank of Canada Valet API |

## 📋 Data Pipeline

### Step 1: Image Capture & OCR
- User uploads receipt image via mobile/web
- Image stored in **Google Cloud Storage** (GCS)
- **Google Cloud Vision** extracts text using `document_text_detection`

### Step 2: AI Parsing with Gemini
- Raw OCR text sent to **Gemini 1.5 Flash**
- Gemini extracts structured data:
  - Vendor name
  - Transaction date
  - Total amount & currency
  - Jurisdiction (USA/Canada)
  - Tax amount (GST/HST for Canada only)
  - Card last 4 digits
  - Expense category

### Step 3: Currency Normalization
- USD expenses → **Bank of Canada Valet API** for daily rate
- Automatic CAD conversion: `Total_CAD = USD_Amount × Daily_Rate`

### Step 4: Verification & Storage
- User reviews extracted data in Review Modal
- Upon verification, data committed to PostgreSQL

## 🏷️ CRA-Compliant Categories

| Category | Keywords |
|----------|----------|
| **Fuel** | Diesel, DEF, Pump, Gas, Petro |
| **Maintenance & Repairs** | Service, Parts, Tire, Mechanic |
| **Meals & Entertainment** | Restaurant, Cafe, Tim Hortons (50% deductible) |
| **Travel (Lodging)** | Hotel, Motel, Inn |
| **Tolls & Scales** | CAT Scale, E-ZPass, 407, Parking |
| **Office & Admin** | Software, Subscription, Supplies |
| **Licenses & Dues** | Govt, Permit, IFTA, MTO |

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Node.js 20+
- PostgreSQL 15+
- Google Cloud Project with:
  - Vision API enabled
  - Vertex AI / Generative AI enabled
  - Cloud Storage bucket created

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment file
cp env.example.txt .env

# Configure .env with your settings
# The google-cloud-vision-key.json is already in place

# Start the server
uvicorn main:app --reload --port 8000
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create environment file
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local

# Start dev server
npm run dev
```

### Docker Setup (Alternative)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f
```

## 🔐 Environment Variables

### Backend (.env)
```bash
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/quickyel

# Google Cloud
GOOGLE_APPLICATION_CREDENTIALS=./google-cloud-vision-key.json
GOOGLE_CLOUD_PROJECT=muhtar-5ab9b
GCS_BUCKET_NAME=quickyel-receipts
GEMINI_MODEL=gemini-1.5-flash

# Security
JWT_SECRET=your-super-secret-key

# Limits
VISION_MONTHLY_LIMIT=1000
```

## 💰 Free Tier Limits

| Service | Free Tier Limit | Usage |
|---------|-----------------|-------|
| Google Vision | 1,000 units/month | OCR extraction |
| Gemini 1.5 Flash | 15 RPM / 1M TPM | Text parsing |
| Cloud Storage | 5 GB | Receipt images |
| Bank of Canada | Unlimited | Exchange rates |

The backend implements rate limiting to ensure you stay within the Google Cloud Vision free tier of 1,000 requests/month.

## 📊 Export Features

The accountant export includes:
- Transaction date & vendor
- CRA-compliant category
- Original currency & amount
- Bank of Canada exchange rate
- **CAD Equivalent Amount** (primary accounting value)
- GST/HST (recoverable Input Tax Credit)
- Payment source (Company Card / Due to Shareholder)
- Direct link to receipt image in GCS

## 🔒 Security Notes

- All operations contained within the `muhtar-5ab9b` Google Cloud project
- Service account (`quickyel@muhtar-5ab9b.iam.gserviceaccount.com`) has Owner role
- JWT-based authentication for API access
- Receipt images stored in private GCS bucket with signed URLs
- CRA-compliant 7-year retention policy on receipt images

## 📱 PWA Features

- Installable on mobile devices
- Camera access for direct receipt capture
- Offline capability (viewing cached data)
- Push notifications (future)

## License

Proprietary - Backtas Softwares / BCKTS_TECH
