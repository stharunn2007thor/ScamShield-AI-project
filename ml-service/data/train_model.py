import pandas as pd
import joblib

from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score

# ==========================================
# Load dataset
# ==========================================

df = pd.read_csv("fraud_transactions.csv")

print("Dataset loaded")
print("Shape:", df.shape)

# ==========================================
# Features and target
# ==========================================

X = df.drop("fraud", axis=1)
y = df["fraud"]

# ==========================================
# Feature types
# ==========================================

categorical_features = [
    "merchant_category"
]

numeric_features = [
    "amount",
    "velocity",
    "device_change",
    "location_change",
    "transaction_frequency"
]

# ==========================================
# Preprocessing
# ==========================================

preprocessor = ColumnTransformer(
    transformers=[
        (
            "categorical",
            OneHotEncoder(handle_unknown="ignore"),
            categorical_features
        )
    ],
    remainder="passthrough"
)

# ==========================================
# Random Forest
# class_weight="balanced" handles imbalance
# ==========================================

model = RandomForestClassifier(
    n_estimators=200,
    max_depth=12,
    min_samples_split=5,
    class_weight="balanced",
    random_state=42,
    n_jobs=-1
)

# ==========================================
# Pipeline
# ==========================================

pipeline = Pipeline(
    steps=[
        ("preprocessor", preprocessor),
        ("model", model)
    ]
)

# ==========================================
# Train / Test split
# ==========================================

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.20,
    random_state=42,
    stratify=y
)

print("\nTraining samples:", len(X_train))
print("Testing samples:", len(X_test))

# ==========================================
# Train
# ==========================================

print("\nTraining model...")

pipeline.fit(X_train, y_train)

print("Training completed!")

# ==========================================
# Predictions
# ==========================================

y_pred = pipeline.predict(X_test)
y_probability = pipeline.predict_proba(X_test)[:, 1]

# ==========================================
# Evaluation
# ==========================================

print("\nClassification Report:")
print(classification_report(y_test, y_pred))

print("Confusion Matrix:")
print(confusion_matrix(y_test, y_pred))

print("ROC-AUC Score:")
print(roc_auc_score(y_test, y_probability))

# ==========================================
# Save model
# ==========================================

joblib.dump(
    pipeline,
    "model/fraud_model.pkl"
)

print("\nModel saved successfully!")
print("Location: model/fraud_model.pkl")