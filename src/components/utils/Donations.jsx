import React from "react";

/**
 * Donations button from PayPal
 */

/**
 * TODO: We should replace that button, it's awfully ugly. A simple highlighted button will do
 */
export default function Donations() {
  return (
    <form
      action="https://www.paypal.com/cgi-bin/webscr"
      method="post"
      target="_blank"
      style={{ height: 26, width: 150, margin: "auto"}}
    >
      <input type="hidden" name="cmd" value="_donations" />
      <input type="hidden" name="business" value="PMHPX79UJJVTA" />
      <input type="hidden" name="item_name" value="Pogify" />
      <input type="hidden" name="currency_code" value="USD" />
      <button
        border="0"
        name="submit"
        title="PayPal - The safer, easier way to pay online!"
        alt="Donate with PayPal button"
        style={{"backgroundColor": "#FFC43B", "color": "#000000", "margin": "auto"}}
      ><strong>Donate</strong></button>
    </form>
  );
};
