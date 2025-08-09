import { Component, OnInit } from '@angular/core';
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
export class AppComponent implements OnInit {
  title = 'SmartSpend';

  // Backend base URL
  apiBase = 'http://localhost:3000/api';

  // State
  linkToken: string | null = null;
  isLinked = false;
  accounts: any[] = [];
  transactions: any[] = [];
  insights: { totalThisMonth: number; topCategories: { name: string; total: number }[] } | null = null;

  // Onboarding state
  showOnboarding = true;
  onboardingStep = 1;
  totalOnboardingSteps = 3;

  // Connection popup state
  showConnectionPopup = false;

  // Loading states
  isLoadingTransactions = false;

  // Chat history
  chatHistory: Array<{type: 'user' | 'ai', message: string, timestamp: Date}> = [];

  private pieChart: Chart | null = null;

  // Chat
  question = '';
  answer = '';

  ngOnInit() {
    // Check if user has already completed onboarding
    const hasCompletedOnboarding = localStorage.getItem('smartspend_onboarding_completed');
    if (hasCompletedOnboarding === 'true') {
      this.showOnboarding = false;
      this.checkConnectionStatus();
    }
  }

  async checkConnectionStatus() {
    try {
      const res = await fetch(`${this.apiBase}/plaid/accounts`);
      if (res.ok) {
        const data = await res.json();
        if (data.accounts && data.accounts.length > 0) {
          this.isLinked = true;
          this.accounts = data.accounts;
          await this.refreshData();
        }
      }
    } catch (error) {
      console.log('No existing connection found');
    }
  }

  nextOnboardingStep() {
    if (this.onboardingStep < this.totalOnboardingSteps) {
      this.onboardingStep++;
    } else {
      this.completeOnboarding();
    }
  }

  previousOnboardingStep() {
    if (this.onboardingStep > 1) {
      this.onboardingStep--;
    }
  }

  async completeOnboarding() {
    this.showOnboarding = false;
    this.showConnectionPopup = true;
    localStorage.setItem('smartspend_onboarding_completed', 'true');
  }

  async closeConnectionPopup() {
    this.showConnectionPopup = false;
    // Check if user connected an account
    if (this.isLinked) {
      await this.refreshData();
    } else {
      // User skipped connection - they can still use the app with CSV upload
      console.log('User skipped account connection');
    }
  }

  async connectAccountFromPopup() {
    try {
      await this.connectBank();
      // The popup will be closed in the onSuccess callback of openPlaidLink
    } catch (error) {
      console.error('Error connecting account from popup:', error);
    }
  }

  skipOnboarding() {
    this.showOnboarding = false;
    localStorage.setItem('smartspend_onboarding_completed', 'true');
  }

  // Method to reset onboarding (for testing)
  resetOnboarding() {
    this.showOnboarding = true;
    this.onboardingStep = 1;
    localStorage.removeItem('smartspend_onboarding_completed');
  }

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
        try {
          await fetch(`${this.apiBase}/plaid/exchange_public_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token })
          });
          this.isLinked = true;
          this.showConnectionPopup = false; // Close the popup
          
          // Wait a moment for Plaid to process the connection, then load data
          setTimeout(async () => {
            await this.refreshData();
            // If transactions are still empty, try again after a longer delay
            if (this.transactions.length === 0) {
              setTimeout(async () => {
                await this.refreshData();
              }, 2000);
            }
          }, 1000);
          
        } catch (error) {
          console.error('Error exchanging token:', error);
        }
      },
      onExit: () => {
        // Handle when user exits Plaid Link
        console.log('User exited Plaid Link');
      },
      onError: (error: any) => {
        console.error('Plaid Link error:', error);
      }
    });
    handler.open();
  }

  async refreshData() {
    try {
      console.log('Refreshing data...');
      this.isLoadingTransactions = true;
      
      const [acctRes, txRes] = await Promise.all([
        fetch(`${this.apiBase}/plaid/accounts`),
        fetch(`${this.apiBase}/plaid/transactions`)
      ]);
      
      if (!acctRes.ok) {
        console.error('Failed to fetch accounts:', acctRes.status, acctRes.statusText);
      }
      if (!txRes.ok) {
        console.error('Failed to fetch transactions:', txRes.status, txRes.statusText);
      }
      
      const acctData = await acctRes.json();
      const txData = await txRes.json();
      
      console.log('Accounts response:', acctData);
      console.log('Transactions response:', txData);
      
      this.accounts = acctData.accounts || [];
      this.transactions = (txData.transactions || []).map((t: any) => ({
        date: t.date,
        name: t.name || t.merchant_name || 'Unknown',
        amount: t.amount,
        category: t.personal_finance_category?.primary || 
                 (Array.isArray(t.category) ? t.category[0] : t.category) || 
                 'Other'
      }));
      
      console.log('Processed transactions:', this.transactions);
      console.log('Transaction count:', this.transactions.length);
      
      await this.computeInsights();
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      this.isLoadingTransactions = false;
    }
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
    if (!this.question.trim()) return;
    
    // Add user question to chat history
    this.chatHistory.push({
      type: 'user',
      message: this.question,
      timestamp: new Date()
    });
    
    // Scroll to bottom after adding user message
    this.scrollToBottom();
    
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

    try {
      const res = await fetch(`${this.apiBase}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: this.question, summary })
      });
      const data = await res.json();
      this.answer = data.answer || 'No response';
      
      // Add AI response to chat history
      this.chatHistory.push({
        type: 'ai',
        message: this.answer,
        timestamp: new Date()
      });
      
      this.question = ''; // Clear the question after asking
      
      // Scroll to bottom after adding AI response
      this.scrollToBottom();
    } catch (error) {
      console.error('Error asking AI:', error);
      this.answer = 'Sorry, I encountered an error. Please try again.';
      
      // Add error response to chat history
      this.chatHistory.push({
        type: 'ai',
        message: this.answer,
        timestamp: new Date()
      });
      
      // Scroll to bottom after adding error response
      this.scrollToBottom();
    }
  }

  // Simplified bank connection flow
  async connectBank() {
    try {
      if (!this.linkToken) {
        await this.createLinkToken();
      }
      this.openPlaidLink();
    } catch (error) {
      console.error('Error connecting bank:', error);
      // Handle error - could show a toast notification
    }
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

  // Auto-scroll to bottom of chat
  scrollToBottom() {
    setTimeout(() => {
      const chatMessages = document.querySelector('.chat-messages');
      if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }, 100);
  }
}
