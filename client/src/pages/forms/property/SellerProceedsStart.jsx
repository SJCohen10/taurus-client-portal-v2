import React, { useState } from "react";

const SELLER_PROCEEDS_FORM_URL =
    "https://forms.zohopublic.com/tauruscapitalfinancegroup/form/ClientPortalQuickRatesApplication/formperma/c90HISe4lSZnneCy3A41lVxvxS2OpRCydid_cm6fZ4s";

function buildUrl(baseUrl, params) {
    const u = new URL(baseUrl);
    Object.entries(params).forEach(([k, v]) => {
        if (v === undefined || v === null || v === "") return;
        u.searchParams.set(k, String(v));
    });
    return u.toString();
}

export default function SellerProceedsStart() {
    const [count, setCount] = useState(1);

    const [b1, setB1] = useState({ bank: "", name: "", number: "" });
    const [b2, setB2] = useState({ bank: "", name: "", number: "" });

    function openForm() {
        const params = {
            // Bank 1
            Seller_Bank: b1.bank,
            Seller_Account_Name: b1.name,
            Seller_Account_Number: b1.number,

            // Optional
            user_email: window?.portalUser?.email || "",
            product_type: "Seller Proceeds Bridging Finance",
        };

        if (count === 2) {
            params.Seller_Second_Bank = b2.bank;
            params.Seller_Second_Account_Name = b2.name;
            params.Seller_Second_Account_Number = b2.number;
        }

        window.location.href = buildUrl(SELLER_PROCEEDS_FORM_URL, params);
    }

    const canContinue =
        b1.bank && b1.name && b1.number && (count === 1 || (b2.bank && b2.name && b2.number));

    return (
        <div>
            <h2>Seller Proceeds Bridging Finance</h2>
            <p className="subtle">
                Enter seller bank details to disburse into (1 or 2 accounts). (POC: assuming details are valid.)
            </p>

            <section className="card">
                <label>Number of seller bank accounts</label>
                <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                </select>
            </section>

            <section className="card form-card">
                <h3>Seller Bank Account 1</h3>
                <div className="form-grid">
                    <label>Seller Bank</label>
                    <input value={b1.bank} onChange={(e) => setB1({ ...b1, bank: e.target.value })} />

                    <label>Seller Account Name</label>
                    <input value={b1.name} onChange={(e) => setB1({ ...b1, name: e.target.value })} />

                    <label>Seller Account Number</label>
                    <input value={b1.number} onChange={(e) => setB1({ ...b1, number: e.target.value })} />
                </div>
            </section>


            {count === 2 && (
                <section className="card form-card">
                    <h3>Seller Bank Account 1</h3>
                    <div className="form-grid">
                        <label>Seller Bank 2</label>
                        <input value={b1.bank} onChange={(e) => setB1({ ...b1, bank: e.target.value })} />

                        <label>Seller Second Account Name</label>
                        <input value={b1.name} onChange={(e) => setB1({ ...b1, name: e.target.value })} />

                        <label>Seller Second Account Number</label>
                        <input value={b1.number} onChange={(e) => setB1({ ...b1, number: e.target.value })} />
                    </div>
                </section>

            )}

            <button className="button" onClick={openForm} disabled={!canContinue}>
                Continue to Seller Proceeds Form
            </button>
        </div>
    );
}
