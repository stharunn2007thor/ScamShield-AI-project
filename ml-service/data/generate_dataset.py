import pandas as pd
import numpy as np

# Reproducibility
np.random.seed(42)

N = 5000

# ==============================
# Generate transaction features
# ==============================

amount = np.random.exponential(scale=15000, size=N)
amount = np.clip(amount, 100, 150000).round(2)

velocity = np.random.poisson(lam=2.5, size=N)
velocity = np.clip(velocity, 1, 15)

device_change = np.random.binomial(1, 0.15, size=N)

location_change = np.random.binomial(1, 0.12, size=N)

transaction_frequency = np.random.poisson(lam=4, size=N)
transaction_frequency = np.clip(transaction_frequency, 1, 20)

# Merchant category
merchant_categories = [
    "GROCERY",
    "FOOD",
    "SHOPPING",
    "TRAVEL",
    "ELECTRONICS",
    "GAMING",
    "CRYPTO",
    "OTHER"
]

merchant_category = np.random.choice(
    merchant_categories,
    size=N,
    p=[0.20, 0.15, 0.20, 0.10, 0.10, 0.08, 0.05, 0.12]
)

# ==============================
# Create fraud probability
# ==============================

risk_score = (
    (amount > 50000) * 2.0
    + (velocity > 5) * 2.5
    + location_change * 2.5 + device_change * 2
    + (transaction_frequency > 10) * 1.5
    + np.isin(merchant_category, ["GAMING", "CRYPTO"]) * 0.8
)

# Convert risk score into probability
probability = 1 / (1 + np.exp(-(risk_score - 3.5)))

# Add randomness
probability = np.clip(probability, 0.01, 0.99)

fraud = np.random.binomial(1, probability)

# ==============================
# Create DataFrame
# ==============================

df = pd.DataFrame({
    "amount": amount,
    "velocity": velocity,
    "device_change": device_change,
    "location_change": location_change,
    "transaction_frequency": transaction_frequency,
    "merchant_category": merchant_category,
    "fraud": fraud
})

# ==============================
# Save dataset
# ==============================

output_file = "fraud_transactions.csv"

df.to_csv(output_file, index=False)

print("Dataset generated successfully!")
print(f"Rows: {len(df)}")
print(f"Columns: {len(df.columns)}")
print(f"Fraud transactions: {df['fraud'].sum()}")
print(f"Normal transactions: {(df['fraud'] == 0).sum()}")
print("\nFirst 5 rows:")
print(df.head())