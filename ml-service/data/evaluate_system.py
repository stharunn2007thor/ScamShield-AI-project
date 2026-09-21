import pandas as pd
import joblib

from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    roc_auc_score
)

# ==========================================
# Load dataset
# ==========================================

df = pd.read_csv("fraud_transactions.csv")

print("==========================================")
print("ScamShield Combined System Evaluation")
print("==========================================")

print("Dataset:", df.shape)

# ==========================================
# Features and target
# ==========================================

X = df.drop("fraud", axis=1)
y = df["fraud"]

# ==========================================
# Same train/test split as train_model.py
# ==========================================

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.20,
    random_state=42,
    stratify=y
)

print("Training samples:", len(X_train))
print("Testing samples:", len(X_test))

# ==========================================
# Load existing trained ML model
# ==========================================

model = joblib.load("model/fraud_model.pkl")

print("\nExisting ML model loaded.")

# ==========================================
# ML fraud probability
# ==========================================

ml_probability = model.predict_proba(X_test)[:, 1]

# ==========================================
# Rule Engine
# Same rules as ScamShield
# ==========================================

HIGH_AMOUNT_THRESHOLD = 50000
HIGH_VELOCITY_THRESHOLD = 5


def calculate_rule_score(transaction):

    rule_score = 0

    amount = float(transaction["amount"])
    velocity = float(transaction["velocity"])
    device_change = int(transaction["device_change"])
    location_change = int(transaction["location_change"])

    if amount > HIGH_AMOUNT_THRESHOLD:
        rule_score += 20

    if velocity > HIGH_VELOCITY_THRESHOLD:
        rule_score += 25

    if device_change == 1:
        rule_score += 20

    if location_change == 1:
        rule_score += 25

    return rule_score


# ==========================================
# Calculate combined Risk Score
# ==========================================

final_scores = []
final_decisions = []

for index, (_, transaction) in enumerate(X_test.iterrows()):

    # ------------------------------
    # Rule Score
    # ------------------------------

    rule_score = calculate_rule_score(transaction)

    # ------------------------------
    # ML Score
    # ------------------------------

    ml_score = float(ml_probability[index]) * 100

    # ------------------------------
    # Graph Risk
    # ------------------------------
    #
    # IMPORTANT:
    # The offline dataset does not contain
    # graph relationships.
    #
    # Therefore graph risk is set to 0
    # for this evaluation.
    #
    # The actual running system can produce
    # graph risk dynamically through Redis.
    # ------------------------------

    graph_risk = 0

    # ------------------------------
    # Same Risk Engine weights
    # ------------------------------

    risk_score = (
        rule_score * 0.30
        + ml_score * 0.50
        + graph_risk * 0.20
    )

    risk_score = round(risk_score)

    final_scores.append(risk_score)

    # ------------------------------
    # Risk Decision
    # ------------------------------

    if risk_score <= 40:

        decision = 0
        # 0 = APPROVED / normal

    elif risk_score <= 75:

        decision = 1
        # 1 = PENDING_OTP
        # treated as suspicious/fraud for
        # binary system evaluation

    else:

        decision = 1
        # BLOCKED = suspicious/fraud

    final_decisions.append(decision)


# ==========================================
# Overall System Accuracy
# ==========================================

accuracy = accuracy_score(
    y_test,
    final_decisions
)

print("\n==========================================")
print("COMBINED SYSTEM RESULTS")
print("==========================================")

print("Overall Accuracy:")
print(round(accuracy * 100, 2), "%")

# ==========================================
# Classification Report
# ==========================================

print("\nClassification Report:")

print(
    classification_report(
        y_test,
        final_decisions,
        target_names=["NORMAL", "FRAUD"]
    )
)

# ==========================================
# Confusion Matrix
# ==========================================

print("Confusion Matrix:")

print(
    confusion_matrix(
        y_test,
        final_decisions
    )
)

# ==========================================
# Display Risk Score Statistics
# ==========================================

print("\nRisk Score Statistics:")

print(
    "Minimum:",
    min(final_scores)
)

print(
    "Maximum:",
    max(final_scores)
)

print(
    "Average:",
    round(sum(final_scores) / len(final_scores), 2)
)

print("\nEvaluation completed.")