CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('razorpay','paddle')),
  ref TEXT NOT NULL,                      -- Razorpay pay_…, Paddle txn_…
  plan TEXT NOT NULL CHECK (plan IN ('day','month','year')),
  amount INTEGER NOT NULL,                -- lowest unit: paise, cents
  currency TEXT NOT NULL,                 -- INR, USD
  status TEXT NOT NULL CHECK (status IN ('paid','refunded')),
  created_at INTEGER NOT NULL,
  refunded_at INTEGER,
  UNIQUE (provider, ref)
);
CREATE INDEX purchases_user ON purchases (user_id);
