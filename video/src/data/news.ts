/**
 * Real, verified news coverage used in the "headlines" problem statement.
 * Headlines and quotes are copied verbatim from the source pages (checked
 * 2026-11-17). The `stat` is a display shorthand directly supported by the quote.
 * Publisher names are set in type only — no third-party logos are used.
 */
export type NewsItem = {
  id: string;
  publisher: string;
  date: string;
  headline: string;
  quote: string;
  /** substring of `quote` to highlight */
  highlight: string;
  stat: { value: number; decimals?: number; prefix?: string; suffix: string; label: string };
  url: string;
  note?: string;
};

export const news: NewsItem[] = [
  {
    id: "wa-3b",
    publisher: "TechCrunch",
    date: "May 1, 2025",
    headline: "WhatsApp now has more than 3 billion users a month",
    quote: "WhatsApp now has more than 3 billion people using it every month, Meta CEO Mark Zuckerberg noted",
    highlight: "more than 3 billion people",
    stat: { value: 3, suffix: "B+", label: "people use WhatsApp every month" },
    url: "techcrunch.com/2025/05/01/whatsapp-now-has-more-than-3-billion-users",
  },
  {
    id: "wa-india",
    publisher: "TechCrunch",
    date: "December 14, 2025",
    headline: "WhatsApp’s biggest market is becoming its toughest test",
    quote: "WhatsApp, which is used by more than 500 million people in India.",
    highlight: "more than 500 million people in India",
    stat: { value: 500, suffix: "M+", label: "WhatsApp users in India" },
    url: "techcrunch.com/2025/12/14/whatsapps-biggest-market-is-becoming-its-toughest-test",
  },
  {
    id: "wa-business",
    publisher: "TechCrunch",
    date: "June 27, 2023",
    headline: "WhatsApp Business crosses 200M MAUs, introduces personalized messages feature",
    quote: "WhatsApp Business, its app designed specifically for small businesses, has crossed the mark of 200 million monthly active users",
    highlight: "200 million monthly active users",
    stat: { value: 200, suffix: "M+", label: "monthly users of the WhatsApp Business app" },
    url: "techcrunch.com/2023/06/27/whatsapp-business-crosses-200m-maus",
  },
  {
    id: "meta-91",
    publisher: "Meta Newsroom",
    date: "May 2026",
    headline: "Introducing Business AI on WhatsApp for Small Businesses in India",
    quote: "According to a Kantar study (2025), 91% of online adults in India chat with a business on a weekly basis,",
    highlight: "91% of online adults in India chat with a business on a weekly basis",
    stat: { value: 91, suffix: "%", label: "of online adults in India chat with a business weekly" },
    url: "about.fb.com/news/2026/05/introducing-business-ai-on-whatsapp-for-small-businesses-in-india",
    note: "Kantar study (2025), cited by Meta",
  },
  {
    id: "voice-7b",
    publisher: "TechCrunch",
    date: "March 30, 2022",
    headline: "People are sending 7 billion voice messages on WhatsApp every day",
    quote: "users on its gigantic messaging app send an average of 7 billion voice messages every day.",
    highlight: "7 billion voice messages every day",
    stat: { value: 7, suffix: "B", label: "voice messages sent every day" },
    url: "techcrunch.com/2022/03/30/people-are-sending-7-billion-voice-messages-on-whatsapp-every-day",
  },
  {
    id: "ms-62",
    publisher: "Microsoft WorkLab · Work Trend Index",
    date: "May 9, 2023",
    headline: "Will AI Fix Work?",
    quote: "62% of survey respondents say they struggle with too much time spent searching for information in their workday.",
    highlight: "too much time spent searching for information",
    stat: { value: 62, suffix: "%", label: "struggle with time lost searching for information" },
    url: "microsoft.com/en-us/worklab/work-trend-index/will-ai-fix-work",
  },
  {
    id: "parseur-9h",
    publisher: "PR Newswire · Parseur survey",
    date: "Jul 30, 2025",
    headline: "Survey: Manual Data Entry Costs American Companies More Than $28,000 Per Employee Each Year",
    quote: "an average of more than nine hours per week to manually transferring data from emails, PDFs, spreadsheets and scanned documents into digital systems",
    highlight: "more than nine hours per week",
    stat: { value: 9, prefix: "", suffix: "+ hrs", label: "a week spent manually transferring data" },
    url: "prnewswire.com/news-releases/survey-manual-data-entry-costs-american-companies…",
    note: "Survey of 500 US professionals, by Parseur",
  },
];
