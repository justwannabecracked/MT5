import MetaTrader5 as mt5
import time
import os
import json
import sys

# Clear screen and set title
os.system('cls')
os.system('title CopyTrading')

# Account credentials
file_path = "accounts.json"
default_data = {
    "account_1": {
        "login": 0,
        "password": "password",
        "server": "server"
    },
    "account_2": {
        "login": 0,
        "password": "password",
        "server": "server"
    }
}

if not os.path.exists(file_path):
    with open(file_path, 'w') as json_file:
        json.dump(default_data, json_file, indent=4)
    print(f"{file_path} created.\n\nPlease enter the accounts' credentials!")
    exit()
else:
    with open(file_path, 'r') as json_file:
        data = json.load(json_file)
    print(f"Data loaded from {file_path}")

account_1 = data["account_1"]
account_2 = data["account_2"]

def login_to_mt5_account(account):
    if not mt5.initialize():
        print(f"[ERROR] MT5 initialize() failed, error: {mt5.last_error()}")
        return False
    
    print(f"[INFO] Logging into account {account['login']} on {account['server']}")
    if not mt5.login(int(account['login']), str(account['password']), str(account['server'])):
        print(f"[ERROR] Login failed for account {account['login']}, error: {mt5.last_error()}")
        return False
    
    print(f"[SUCCESS] Logged into account {account['login']}")
    return True

def copy_trade_to_account_2(trade, master_balance):
    # Get slave account info (while logged into account 2)
    slave_info = mt5.account_info()
    if slave_info is None:
        print(f"[ERROR] Could not retrieve slave account info: {mt5.last_error()}")
        return None
    slave_balance = slave_info.balance

    # Calculate new volume based on the balance ratio between slave and master
    if master_balance <= 0:
        print("[ERROR] Master account balance is zero or negative.")
        return None

    ratio = slave_balance / master_balance
    new_volume = trade.volume * ratio
    new_volume = round(new_volume, 2)  # Adjust rounding as needed

    symbol = trade.symbol
    order_type = mt5.ORDER_TYPE_BUY if trade.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_SELL
    price = trade.price_current
    sl = trade.sl
    tp = trade.tp

    request = {
        'action': mt5.TRADE_ACTION_DEAL,
        'symbol': symbol,
        'volume': new_volume,
        'type': order_type,
        'price': price,
        'sl': sl,
        'tp': tp,
        'deviation': 20,
        'magic': 0,
        'comment': 'Copied trade',
        'type_time': mt5.ORDER_TIME_GTC,
        'type_filling': mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request)
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        print(f"[ERROR] Failed to copy trade to account 2: {result.comment}")
        return None
    else:
        print(f"[SUCCESS] Trade copied to account 2 with ticket {result.order}")
        return result.order

def monitor_trades(account_1, account_2):
    # Login to the master account (account 1)
    if not login_to_mt5_account(account_1):
        return

    # Record initial trades so that only trades opened after the bot starts are considered.
    initial_trades = mt5.positions_get()
    if initial_trades is None:
        print("[ERROR] Could not retrieve initial positions:", mt5.last_error())
        return
    # Keep track of already processed trade tickets
    known_trade_ids = {trade.ticket for trade in initial_trades}

    copied_trades = {}

    while True:
        current_trades = mt5.positions_get()
        if current_trades is None:
            time.sleep(2)
            continue

        # Create a set of current trade ticket IDs
        current_trade_ids = {trade.ticket for trade in current_trades}
        # Identify trades that have just been executed (new trade IDs not in known_trade_ids)
        new_trade_ids = current_trade_ids - known_trade_ids

        if new_trade_ids:
            # Get master account info (balance) before switching accounts
            master_info = mt5.account_info()
            if master_info is None:
                print("[ERROR] Could not retrieve master account info:", mt5.last_error())
                time.sleep(1)
                continue
            master_balance = master_info.balance

            for trade_id in new_trade_ids:
                trade = next((t for t in current_trades if t.ticket == trade_id), None)
                if trade and trade.sl != 0 and trade.tp != 0:
                    # Switch to slave account (account 2)
                    if not login_to_mt5_account(account_2):
                        continue
                    copied_trade_id = copy_trade_to_account_2(trade, master_balance)
                    if copied_trade_id:
                        copied_trades[trade_id] = copied_trade_id
                    # Switch back to master account (account 1) for further monitoring
                    if not login_to_mt5_account(account_1):
                        return
            # Update known_trade_ids to include the newly detected trades
            known_trade_ids = current_trade_ids

        # Wait before checking for new trades
        time.sleep(1)

def close_trade_on_account_2(trade_id):
    positions = mt5.positions_get()
    if positions is None:
        print(f"[ERROR] Failed to get positions for account 2: {mt5.last_error()}")
        return None

    for position in positions:
        if position.ticket == trade_id:
            symbol = position.symbol
            volume = position.volume
            order_type = mt5.ORDER_TYPE_SELL if position.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY

            price = mt5.symbol_info_tick(symbol).bid if order_type == mt5.ORDER_TYPE_SELL else mt5.symbol_info_tick(symbol).ask

            request = {
                'action': mt5.TRADE_ACTION_DEAL,
                'position': position.ticket,
                'symbol': symbol,
                'volume': volume,
                'type': order_type,
                'price': price,
                'deviation': 20,
                'magic': 0,
                'comment': 'Close copied trade',
                'type_time': mt5.ORDER_TIME_GTC,
                'type_filling': mt5.ORDER_FILLING_IOC,
            }

            result = mt5.order_send(request)
            if result.retcode != mt5.TRADE_RETCODE_DONE:
                print(f"[ERROR] Failed to close trade on account 2: {result.comment}")
                return None
            else:
                print(f"[SUCCESS] Trade {trade_id} closed on account 2")
                return result.order

    print(f"[INFO] Trade {trade_id} not found on account 2")
    return None

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "monitor":
        with open("accounts.json", "r") as json_file:
            data = json.load(json_file)
        account_1 = data["account_1"]
        account_2 = data["account_2"]

        print("[INFO] Starting trade monitoring...")
        monitor_trades(account_1, account_2)
    else:
        print("[ERROR] No valid argument provided.")


