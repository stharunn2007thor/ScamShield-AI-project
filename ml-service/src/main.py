from fastapi import FastAPI
import joblib
import pandas as pd

app = FastAPI(
    title="ScamShield ML Service",
    version="1.0.0"
)

# Load trained model
model = joblib.load("model/fraud_model.pkl")


@app.get("/health")
def health():
    return {
        "service": "ml-service",
        "status": "OK"
    }


@app.post("/predict")
def predict(transaction: dict):

    data = pd.DataFrame([{
        "amount": transaction["amount"],
        "velocity": transaction["velocity"],
        "device_change": transaction["device_change"],
        "location_change": transaction["location_change"],
        "transaction_frequency": transaction["transaction_frequency"],
        "merchant_category": transaction["merchant_category"]
    }])

    probability = model.predict_proba(data)[0][1]

    return {
        "fraudProbability": round(float(probability), 4)
    }