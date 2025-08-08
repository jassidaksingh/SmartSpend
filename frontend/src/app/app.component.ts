import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Chart from 'chart.js/auto';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'SmartSpend';

  // Backend base URL
  apiBase = 'http://localhost:3000/api';

  // State
  linkToken: string | null = null;
  isLinked = false;
  accounts: any[] = [];
  transactions: any[] = [];
  insights: { totalThisMonth: number; topCategories: { name: string; total: number }[] } | null = null;

  private pieChart: Chart | null = null;

  // Chat
  question = '';
  answer = '';

  async createLinkToken() {
    const res = await fetch(`${this.apiBase}/plaid/create_link_token`, { method: 'POST' });
    const data = await res.json();
    this.linkToken = data.link_token;
  }

  openPlaidLink() {
    if (!this.linkToken) return;
    // @ts-ignore
    const handler = window.Plaid.create({
      token: this.linkToken,
      onSuccess: async (public_token: string) => {
        await fetch(`${this.apiBase}/plaid/exchange_public_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token })
        });
        this.isLinked = true;
        await this.refreshData();
      },
    });
    handler.open();
  }

  async refreshData() {
    const [acctRes, txRes] = await Promise.all([
      fetch(`${this.apiBase}/plaid/accounts`),
      fetch(`${this.apiBase}/plaid/transactions`)
    ]);
    const acctData = await acctRes.json();
    const txData = await txRes.json();
    this.accounts = acctData.accounts || [];
    this.transactions = (txData.transactions || []).map((t: any) => ({
      date: t.date,
      name: t.name || t.merchant_name,
      amount: t.amount,
      category: t.personal_finance_category?.primary || (Array.isArray(t.category) ? t.category[0] : t.category)
    }));
    await this.computeInsights();
  }

  async computeInsights() {
    console.log('Computing insights with transactions:', this.transactions);
    const res = await fetch(`${this.apiBase}/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: this.transactions })
    });
    const data = await res.json();
    console.log('Insights response:', data);
    this.insights = data.insights;
    this.renderCharts();
  }

  onCsvSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);
    fetch(`${this.apiBase}/upload-csv`, { method: 'POST', body: formData })
      .then(r => r.json())
      .then(async data => {
        this.transactions = data.transactions || [];
        await this.computeInsights();
      });
  }

  async ask() {
    // Create a comprehensive financial summary for the AI
    const totalBalance = this.getTotalBalance();
    const transactionCount = this.transactions.length;
    const recentTransactions = this.transactions.slice(0, 5).map(t => 
      `${t.name}: ${t.amount < 0 ? '-' : '+'}$${Math.abs(t.amount)} (${this.formatCategoryName(t.category)})`
    );

    const summary = `Total Monthly Spending: $${this.insights?.totalThisMonth || 0}
Total Account Balance: $${totalBalance}
Number of Transactions: ${transactionCount}

Top Spending Categories:
${this.insights?.topCategories?.map(c => `- ${this.formatCategoryName(c.name)}: $${c.total}`).join('\n') || 'No categories yet'}

Recent Transactions:
${recentTransactions.join('\n') || 'No recent transactions'}`;

    const res = await fetch(`${this.apiBase}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: this.question, summary })
    });
    const data = await res.json();
    this.answer = data.answer || 'No response';
    this.question = ''; // Clear the question after asking
  }

  // Simplified bank connection flow
  async connectBank() {
    if (!this.linkToken) {
      await this.createLinkToken();
    }
    this.openPlaidLink();
  }

  // Get total balance from accounts
  getTotalBalance(): number {
    return this.accounts.reduce((total, account) => {
      return total + (account.balances?.current || 0);
    }, 0);
  }

  // Get consistent colors for categories
  getCategoryColor(index: number): string {
    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#f97316'];
    return colors[index % colors.length];
  }

  // Format category names to be more readable
  formatCategoryName(category: string): string {
    return category.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
  }

  // Get account type display name
  getAccountType(type: string): string {
    const typeMap: { [key: string]: string } = {
      'depository': 'Checking',
      'credit': 'Credit Card',
      'loan': 'Loan',
      'investment': 'Investment'
    };
    return typeMap[type] || type;
  }

  // Get transaction icon based on category
  getTransactionIcon(category: string): string {
    const iconMap: { [key: string]: string } = {
      'FOOD_AND_DRINK': '🍽️',
      'TRAVEL': '✈️',
      'TRANSPORTATION': '🚗',
      'ENTERTAINMENT': '🎬',
      'GENERAL_MERCHANDISE': '🛍️',
      'GENERAL_SERVICES': '🔧',
      'LOAN_PAYMENTS': '🏦',
      'PERSONAL_CARE': '💅',
      'Other': '💸'
    };
    return iconMap[category] || '💸';
  }

  // Format date for better display
  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const today = new Date();
    const diffTime = Math.abs(today.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) return 'Today';
    if (diffDays === 2) return 'Yesterday';
    if (diffDays <= 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Get suggested questions for AI
  getSuggestedQuestions(): string[] {
    return [
      "How much did I spend this month?",
      "What's my biggest expense category?",
      "Am I spending too much on food?",
      "How can I save more money?"
    ];
  }

  // Handle Enter key in chat input
  onEnterKey(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (!keyboardEvent.shiftKey && this.question.trim()) {
      keyboardEvent.preventDefault();
      this.ask();
    }
  }

  private renderCharts() {
    if (!this.insights || !this.insights.topCategories || this.insights.topCategories.length === 0) {
      console.log('No insights data available for charts');
      return;
    }

    const labels = this.insights.topCategories.map(c => c.name);
    const amounts = this.insights.topCategories.map(c => Math.abs(c.total)); // Use absolute values

    console.log('Chart data:', { labels, amounts });

    // Dark theme chart configuration
    const darkTheme = {
      backgroundColor: ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#f97316'],
      borderColor: '#333333',
      textColor: '#ffffff'
    };

    const pieCtx = document.getElementById('pieChart') as HTMLCanvasElement | null;

    if (pieCtx) {
      if (this.pieChart) {
        this.pieChart.destroy();
      }
      
      this.pieChart = new Chart(pieCtx, {
        type: 'pie',
        data: {
          labels,
          datasets: [{ 
            data: amounts, 
            backgroundColor: darkTheme.backgroundColor.slice(0, labels.length),
            borderColor: darkTheme.borderColor,
            borderWidth: 2
          }]
        },
        options: { 
          responsive: true, 
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: darkTheme.textColor,
                padding: 20,
                usePointStyle: true
              }
            },
            tooltip: {
              callbacks: {
                label: function(context: any) {
                  const label = context.label || '';
                  const value = context.parsed || 0;
                  const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                  const percentage = ((value / total) * 100).toFixed(1);
                  return `${label}: $${value.toFixed(2)} (${percentage}%)`;
                }
              }
            }
          }
        }
      });
      console.log('Pie chart created successfully');
    } else {
      console.error('Could not find pieChart canvas element');
    }
  }
}
