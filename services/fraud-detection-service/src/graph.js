async function analyzeGraph(transaction, redis) {

    const graphSignals = [];
    let graphRisk = 0;

    const userId = transaction.userId;
    const deviceId = transaction.deviceId;

    const deviceUsersKey = `graph:device:${deviceId}:users`;

    // Get existing users BEFORE adding current user
    const users = await redis.sMembers(deviceUsersKey);

    console.log("Graph Device:", deviceId);
    console.log("Existing Users:", users);

    // Detect whether another user already uses this device
    const otherUsers = users.filter(
        user => user !== userId
    );

    if (otherUsers.length > 0) {

        graphRisk += 20;

        graphSignals.push(
            "DEVICE_SHARED_BY_MULTIPLE_USERS"
        );
    }

    // Add current user to graph relationship
    await redis.sAdd(deviceUsersKey, userId);

    return {
        graphRisk,
        graphSignals
    };
}

module.exports = {
    analyzeGraph
};