import("metaapi.cloud-sdk/esm-node").then(({ default: MetaApi }) => {
  const token = process.env.TOKEN;
  const api = new MetaApi(token);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loginToMetaApiAccount(account) {
    try {
      const connection = await api.metatraderAccountApi.getAccount(
        account.login
      );
      if (!connection) {
        console.error(`[ERROR] Login failed for account ${account.login}`);
        return null;
      }
      await connection.connect();
      console.log(`[SUCCESS] Logged into account ${account.login}`);
      return connection;
    } catch (error) {
      console.error(`[ERROR] Failed to login:`, error);
      return null;
    }
  }

  async function copyTradeToAccount2(trade, masterBalance, slaveAccount) {
    try {
      const slaveInfo = await slaveAccount.getAccountInformation();
      if (!slaveInfo) {
        console.error("[ERROR] Could not retrieve slave account info");
        return;
      }
      const slaveBalance = slaveInfo.balance;
      const ratio = slaveBalance / masterBalance;
      const newVolume = (trade.volume * ratio).toFixed(2);

      const order = {
        symbol: trade.symbol,
        volume: newVolume,
        type: trade.type === "BUY" ? "BUY" : "SELL",
        price: trade.price,
        stopLoss: trade.sl,
        takeProfit: trade.tp,
        comment: "Copied trade",
      };

      await slaveAccount.createMarketOrder(order);
      console.log(`[SUCCESS] Trade copied to account ${slaveAccount.login}`);
    } catch (error) {
      console.error("[ERROR] Failed to copy trade", error);
    }
  }

  async function monitorTrades(account1, account2) {
    const masterAccount = await loginToMetaApiAccount(account1);
    const slaveAccount = await loginToMetaApiAccount(account2);
    if (!masterAccount || !slaveAccount) return;

    const knownTradeIds = new Set();

    while (true) {
      try {
        const trades = await masterAccount.getPositions();
        if (!trades) {
          await sleep(2000);
          continue;
        }

        const currentTradeIds = new Set(trades.map((trade) => trade.id));
        const newTradeIds = [...currentTradeIds].filter(
          (id) => !knownTradeIds.has(id)
        );

        if (newTradeIds.length > 0) {
          const masterInfo = await masterAccount.getAccountInformation();
          if (!masterInfo) {
            console.error("[ERROR] Could not retrieve master account info");
            await sleep(1000);
            continue;
          }
          const masterBalance = masterInfo.balance;

          for (let tradeId of newTradeIds) {
            let trade = trades.find((t) => t.id === tradeId);
            if (trade && trade.sl !== 0 && trade.tp !== 0) {
              await copyTradeToAccount2(trade, masterBalance, slaveAccount);
            }
          }
          newTradeIds.forEach((id) => knownTradeIds.add(id));
        }
      } catch (error) {
        console.error("[ERROR] Error monitoring trades", error);
      }
      await sleep(1000);
    }
  }
  return { monitorTrades, loginToMetaApiAccount, copyTradeToAccount2 };
});
