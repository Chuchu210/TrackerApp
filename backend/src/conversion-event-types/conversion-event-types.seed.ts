export const DEFAULT_CONVERSION_EVENT_TYPES: {
  slug: string;
  displayLabel: string;
  sortOrder: number;
  countsAsConversion: boolean;
}[] = [
  { slug: 'viewcontent', displayLabel: 'ViewCONTENT revenue', sortOrder: 5, countsAsConversion: false },
  { slug: 'quiz_started', displayLabel: 'Quiz started', sortOrder: 6, countsAsConversion: false },
  { slug: 'quiz_q2', displayLabel: 'Question 2', sortOrder: 7, countsAsConversion: false },
  { slug: 'quiz_q3', displayLabel: 'Question 3', sortOrder: 8, countsAsConversion: false },
  { slug: 'click_button', displayLabel: 'Click Button revenue', sortOrder: 9, countsAsConversion: false },
  { slug: 'call_click', displayLabel: 'Call started', sortOrder: 10, countsAsConversion: false },
  { slug: 'lead', displayLabel: 'Lead revenue', sortOrder: 11, countsAsConversion: true },
  { slug: 'call_connected', displayLabel: 'Call Connected revenue', sortOrder: 14, countsAsConversion: true },
  { slug: 'sale', displayLabel: 'Sales revenue', sortOrder: 20, countsAsConversion: true },
  { slug: 'sales', displayLabel: 'Sales revenue', sortOrder: 21, countsAsConversion: true },
  { slug: 'purchase', displayLabel: 'Purchase revenue', sortOrder: 30, countsAsConversion: true },
  { slug: 'postalcode', displayLabel: 'PostalCode revenue', sortOrder: 50, countsAsConversion: true },
  { slug: 'account_opening', displayLabel: 'account_opening revenue', sortOrder: 60, countsAsConversion: true },
  { slug: 'account_validated', displayLabel: 'account_validated revenue', sortOrder: 70, countsAsConversion: true },
  { slug: 'age_60', displayLabel: 'Age_60 revenue', sortOrder: 80, countsAsConversion: true },
  { slug: 'hearing_loss', displayLabel: 'Hearing_loss revenue', sortOrder: 90, countsAsConversion: true },
  { slug: 'test', displayLabel: 'test revenue', sortOrder: 100, countsAsConversion: false },
];
