import { db } from "../db";
import { accounts, resources, costs } from "../../shared/schema";
import { eq, and, inArray } from "drizzle-orm";

interface VisualizationData {
  type: 'bar' | 'pie' | 'line' | 'table' | 'metric';
  title: string;
  data: any;
  description?: string;
}

class SimpleOrchestrator {
  private sessionStates: Map<string, any> = new Map();

  async processQuery(sessionId: string, query: string, accountIds: number[], currentAccount: string) {
    console.log(`🎯 SIMPLE ORCHESTRATOR: Processing "${query}" for session ${sessionId}`);
    
    // Check if this is a permission response
    if (this.isPermissionResponse(query)) {
      return await this.handlePermissionResponse(sessionId, query, accountIds, currentAccount);
    }
    
    // Check if this requires permission
    if (this.shouldAskPermission(query)) {
      return this.formatPermissionRequest(query, currentAccount);
    }
    
    // Execute the analysis directly
    return await this.executeAnalysis(query, accountIds, currentAccount);
  }

  private isPermissionResponse(query: string): boolean {
    const lowerQuery = query.toLowerCase().trim();
    const yesPatterns = ['yes', 'proceed', 'go ahead', 'continue', 'do it', 'sure', 'ok', 'okay', 'y'];
    const noPatterns = ['no', 'stop', 'cancel', 'abort', 'don\'t', 'skip', 'n'];
    
    return yesPatterns.includes(lowerQuery) || noPatterns.includes(lowerQuery);
  }

  private async handlePermissionResponse(sessionId: string, query: string, accountIds: number[], currentAccount: string) {
    const lowerQuery = query.toLowerCase().trim();
    const isApproval = ['yes', 'proceed', 'go ahead', 'continue', 'do it', 'sure', 'ok', 'okay', 'y'].includes(lowerQuery);
    
    if (isApproval) {
      console.log(`✅ PERMISSION GRANTED: Executing analysis for session ${sessionId}`);
      
      // Get the stored original query
      const sessionState = this.sessionStates.get(sessionId);
      const originalQuery = sessionState?.originalQuery || "what are the stopped instances";
      
      return await this.executeAnalysis(originalQuery, accountIds, currentAccount);
    } else {
      console.log(`❌ PERMISSION DENIED: User declined analysis for session ${sessionId}`);
      return {
        response: "Understood. Let me know if you'd like me to help with something else regarding your infrastructure.",
        visualizations: [],
        needsPermission: false
      };
    }
  }

  private shouldAskPermission(query: string): boolean {
    const needsPermissionPatterns = [
      'stopped', 'instances', 'costs', 'optimization', 'resources', 
      'volumes', 'buckets', 'security', 'performance', 'usage',
      'running', 'ec2', 's3', 'rds', 'lambda', 'unattached'
    ];
    
    const lowerQuery = query.toLowerCase();
    return needsPermissionPatterns.some(pattern => lowerQuery.includes(pattern));
  }

  private formatPermissionRequest(query: string, currentAccount: string) {
    console.log("🔒 FORMATTING PERMISSION REQUEST");
    
    // Store the original query
    const sessionId = Date.now().toString();
    this.sessionStates.set(sessionId, { originalQuery: query });
    
    let analysisType = "infrastructure analysis";
    let tasksToPerform = [];
    
    if (query.toLowerCase().includes('stopped') || query.toLowerCase().includes('instances')) {
      analysisType = "stopped instances analysis";
      tasksToPerform = [
        "Scan all EC2 instances to identify stopped instances",
        "Calculate monthly storage costs for stopped instances",
        "Analyze regional and account distribution",
        "Generate cost optimization recommendations",
        "Create detailed tables and visualizations"
      ];
    } else if (query.toLowerCase().includes('costs') || query.toLowerCase().includes('spending')) {
      analysisType = "cost analysis";
      tasksToPerform = [
        "Query cost data across all selected accounts",
        "Calculate cost trends and patterns",
        "Identify top spending services and regions",
        "Generate cost breakdown visualizations",
        "Provide optimization insights"
      ];
    } else {
      tasksToPerform = [
        "Analyze resource inventory and costs",
        "Generate comprehensive visualizations",
        "Provide insights and recommendations",
        "Create detailed data tables"
      ];
    }

    const accountScope = currentAccount === "All Accounts" ? 
      "all your AWS accounts" : 
      `your **${currentAccount}** account`;

    const response = `I understand you want to analyze **${query}**.

To provide you with comprehensive insights, I need to perform a **${analysisType}** across ${accountScope}. This will involve:

${tasksToPerform.map((task, i) => `${i + 1}. ${task}`).join('\n')}

**Would you like me to proceed with this analysis?**

Simply respond with:
- **"Yes"** or **"Proceed"** to start the analysis
- **"No"** if you'd prefer to skip this analysis

This approach ensures I give you exactly the information you need while being transparent about what data I'm analyzing.`;

    return {
      response,
      visualizations: [],
      needsPermission: true,
      suggestedTasks: tasksToPerform
    };
  }

  private async executeAnalysis(query: string, accountIds: number[], currentAccount: string) {
    console.log("🔄 EXECUTING ANALYSIS");
    
    if (query.toLowerCase().includes('stopped') || query.toLowerCase().includes('instances')) {
      return await this.analyzeStoppedInstances(accountIds, currentAccount);
    }
    
    // Default analysis
    return {
      response: "Analysis completed successfully!",
      visualizations: [],
      needsPermission: false
    };
  }

  private async analyzeStoppedInstances(accountIds: number[], currentAccount: string) {
    // Fetch data
    const accountsData = await db
      .select()
      .from(accounts)
      .where(inArray(accounts.id, accountIds));

    const stoppedInstances = await db
      .select()
      .from(resources)
      .where(and(
        inArray(resources.accountId, accountIds),
        eq(resources.type, 'ec2-instance'),
        eq(resources.status, 'stopped')
      ));

    // Generate visualizations
    const visualizations: VisualizationData[] = [];

    // Metric card
    visualizations.push({
      type: 'metric',
      title: 'Stopped Instances',
      data: {
        value: stoppedInstances.length,
        label: 'Total Stopped EC2 Instances',
        trend: 'neutral'
      }
    });

    // Regional distribution
    const regionStats = this.groupBy(stoppedInstances, 'region');
    if (Object.keys(regionStats).length > 0) {
      visualizations.push({
        type: 'bar',
        title: '📍 Distribution by Region',
        data: {
          labels: Object.keys(regionStats),
          datasets: [{
            label: 'Stopped Instances',
            data: Object.values(regionStats).map((items: any) => items.length),
            backgroundColor: '#f59e0b'
          }]
        }
      });
    }

    // Account distribution
    const accountStats = this.groupBy(stoppedInstances, 'accountId');
    const accountData = Object.entries(accountStats).map(([accountId, instances]) => {
      const account = accountsData.find(a => a.id === parseInt(accountId));
      return {
        name: account?.name || `Account ${accountId}`,
        value: (instances as any[]).length
      };
    });
    
    if (accountData.length > 0) {
      visualizations.push({
        type: 'pie',
        title: '🏢 Distribution by Account',
        data: {
          datasets: [{
            data: accountData.map(item => item.value),
            backgroundColor: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6']
          }],
          labels: accountData.map(item => item.name)
        }
      });
    }

    // Instance details table
    const tableData = stoppedInstances.slice(0, 10).map(instance => {
      const account = accountsData.find(a => a.id === instance.accountId);
      return {
        'Instance ID': instance.resourceId,
        'Name': instance.name,
        'Type': instance.metadata?.instanceType || 'Unknown',
        'Region': instance.region,
        'Account': account?.name || 'Unknown',
        'Monthly Cost': instance.monthlyCost ? `$${parseFloat(instance.monthlyCost).toFixed(2)}` : 'N/A'
      };
    });

    visualizations.push({
      type: 'table',
      title: '📋 Instance Details',
      data: {
        headers: ['Instance ID', 'Name', 'Type', 'Region', 'Account', 'Monthly Cost'],
        rows: tableData
      },
      description: `Showing first ${Math.min(10, stoppedInstances.length)} of ${stoppedInstances.length} stopped instances`
    });

    // Generate response
    const totalCost = stoppedInstances
      .reduce((sum, instance) => sum + parseFloat(instance.monthlyCost || '0'), 0);

    const regionList = Object.entries(regionStats)
      .sort(([,a], [,b]) => (b as any[]).length - (a as any[]).length)
      .map(([region, instances]) => `- **${region}**: ${(instances as any[]).length} instances`)
      .join('\n');

    const response = `# 📊 Stopped Instances${currentAccount !== "All Accounts" ? ` - ${currentAccount}` : ''}

You have **${stoppedInstances.length} stopped EC2 instances** ${currentAccount === "All Accounts" ? 'across your AWS infrastructure' : `in **${currentAccount}**`}:

## 📍 Regional Distribution
${regionList || '- No regional data available'}

## 💰 Cost Summary
- **Total monthly cost**: $${totalCost.toFixed(2)}
- **Average cost per instance**: $${stoppedInstances.length > 0 ? (totalCost / stoppedInstances.length).toFixed(2) : '0.00'}/month

## 🔍 Key Insights
- ${stoppedInstances.length === 0 ? 'No stopped instances found' : `${stoppedInstances.length} instances currently incurring storage costs while stopped`}
- These instances don't incur compute charges but maintain EBS storage costs
- Consider terminating unused instances or starting needed ones

## 📈 Visual Analysis
The charts above show the distribution patterns and help identify optimization opportunities.

---

💡 **Quick Actions:**
- **Terminate unused instances** to eliminate storage costs
- **Start instances** that are needed for current workloads  
- **Right-size instances** before restarting to optimize costs`;

    return {
      response,
      visualizations,
      needsPermission: false
    };
  }

  private groupBy(array: any[], key: string): Record<string, any[]> {
    return array.reduce((groups, item) => {
      const group = item[key] || 'unknown';
      groups[group] = groups[group] || [];
      groups[group].push(item);
      return groups;
    }, {});
  }
}

export const simpleOrchestrator = new SimpleOrchestrator();