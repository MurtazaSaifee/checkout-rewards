import { CUSTOMERS, type CustomerId } from './customer';

export function CustomerSwitcher({
  value,
  onChange,
}: {
  value: CustomerId;
  onChange: (customer: CustomerId) => void;
}) {
  return (
    <label className="customer-switcher">
      Customer{' '}
      <select
        value={value}
        onChange={(event) => {
          const next = CUSTOMERS.find((customer) => customer === event.target.value);
          if (next !== undefined) onChange(next);
        }}
      >
        {CUSTOMERS.map((customer) => (
          <option key={customer} value={customer}>
            {customer}
          </option>
        ))}
      </select>
    </label>
  );
}
