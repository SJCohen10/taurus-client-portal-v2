import React, { useState } from "react";
import { faqItems } from "../../data/faqItems";

export default function FaqPage() {
  const [openItemId, setOpenItemId] = useState(faqItems[0]?.id || "");

  return (
    <section className="card faq-card">
      <h2>Frequently Asked Questions</h2>
      <p className="subtle">Helpful answers for common portal workflows.</p>

      <div className="faq-list">
        {faqItems.map((item) => {
          const isOpen = openItemId === item.id;
          return (
            <div key={item.id} className="faq-item">
              <button
                type="button"
                className="faq-question"
                onClick={() => setOpenItemId(isOpen ? "" : item.id)}
                aria-expanded={isOpen ? "true" : "false"}
              >
                <span>{item.question}</span>
                <span>{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && <p className="faq-answer">{item.answer}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
