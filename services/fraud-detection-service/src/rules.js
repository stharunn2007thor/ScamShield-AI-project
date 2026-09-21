const HIGH_AMOUNT_THRESHOLD = 50000;
const HIGH_VELOCITY_THRESHOLD = 5;

function evaluateRules(transaction, velocity) {

    let ruleScore = 0;
    const rulesTriggered = [];

    // Rule A — High Amount
    if (Number(transaction.amount) > HIGH_AMOUNT_THRESHOLD) {
        ruleScore += 20;
        rulesTriggered.push("HIGH_AMOUNT");
    }

    // Rule B — High Velocity
    if (velocity > HIGH_VELOCITY_THRESHOLD) {
        ruleScore += 25;
        rulesTriggered.push("HIGH_VELOCITY");
    }

    // Rule C — New Device
    if (
        transaction.deviceId !==
        transaction.registeredDevice
    ) {
        ruleScore += 20;
        rulesTriggered.push("NEW_DEVICE");
    }

    // Rule D — Location Anomaly
    if (
        transaction.location !==
        transaction.registeredLocation
    ) {
        ruleScore += 25;
        rulesTriggered.push("LOCATION_ANOMALY");
    }

    return {
        ruleScore,
        rulesTriggered
    };
}

module.exports = {
    evaluateRules
};