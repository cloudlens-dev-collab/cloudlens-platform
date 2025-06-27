import { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand, DescribeVpcsCommand, DescribeSecurityGroupsCommand, DescribeSubnetsCommand, DescribeNetworkAclsCommand, DescribeRouteTablesCommand, DescribeInternetGatewaysCommand } from "@aws-sdk/client-ec2";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { AutoScalingClient, DescribeAutoScalingGroupsCommand } from "@aws-sdk/client-auto-scaling";
import type { Account, Resource, Cost } from "@shared/schema";
import { createLogger } from './logger';
import { withRetry, handleAWSError, CircuitBreaker } from './error-handler';
import { caches, cacheKeys } from './cache';
import { sanitize, validateDataQuality } from './validation';

export class AWSService {
  private clients: Map<string, any> = new Map();
  private logger = createLogger('AWSService');
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  private async getCredentials(account: Account) {
    const credentials = account.credentials as any;
    
    // Set environment variables for AWS authentication
    if (credentials.accessKeyId) {
      process.env.AWS_ACCESS_KEY_ID = credentials.accessKeyId;
    }
    if (credentials.secretAccessKey) {
      process.env.AWS_SECRET_ACCESS_KEY = credentials.secretAccessKey;
    }
    if (credentials.sessionToken) {
      process.env.AWS_SESSION_TOKEN = credentials.sessionToken;
    }
    if (credentials.region) {
      process.env.AWS_DEFAULT_REGION = credentials.region;
    }
    
    // Return credentials object for direct use
    if (credentials.accessKeyId && credentials.secretAccessKey) {
      const creds = {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        ...(credentials.sessionToken && { sessionToken: credentials.sessionToken })
      };
      return creds;
    }
    
    // Fallback to environment variables
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      const creds = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN })
      };
      return creds;
    }
    
    throw new Error("No valid AWS credentials found. Provide accessKeyId, secretAccessKey, and optionally sessionToken");
  }

  private async getClient(account: Account, service: string, region = "us-east-1") {
    const clientKey = `${account.id}-${service}-${region}`;
    
    if (!this.clients.has(clientKey)) {
      this.logger.debug('Creating AWS client', { 
        accountName: account.name,
        service,
        region 
      });
      
      const credentials = await this.getCredentials(account);
      
      let client;
      switch (service) {
        case "ec2":
          client = new EC2Client({ region, credentials });
          break;
        case "rds":
          client = new RDSClient({ region, credentials });
          break;
        case "s3":
          client = new S3Client({ region, credentials });
          break;
        case "cost-explorer":
          client = new CostExplorerClient({ region: "us-east-1", credentials }); // Cost Explorer is only in us-east-1
          break;
        case "lambda":
          client = new LambdaClient({ region, credentials });
          break;
        case "elbv2":
          client = new ElasticLoadBalancingV2Client({ region, credentials });
          break;
        case "autoscaling":
          client = new AutoScalingClient({ region, credentials });
          break;
        default:
          this.logger.error('Unsupported AWS service requested', { service });
          throw new Error(`Unsupported AWS service: ${service}`);
      }
      
      this.clients.set(clientKey, client);
      this.logger.info('AWS client created', { 
        accountName: account.name,
        service,
        region 
      });
    }
    
    return this.clients.get(clientKey);
  }
  
  private getCircuitBreaker(service: string): CircuitBreaker {
    if (!this.circuitBreakers.has(service)) {
      this.circuitBreakers.set(service, new CircuitBreaker(`aws-${service}`));
    }
    return this.circuitBreakers.get(service)!;
  }

  async syncResources(account: Account): Promise<Resource[]> {
    this.logger.sync(account.name, 'started', { provider: 'aws' });
    const startTime = Date.now();
    
    const resources: Resource[] = [];
    // Prioritize primary regions first, then expand to others
    const regions = [
      "us-west-2", "us-east-1", "us-east-2", "us-west-1",
      "eu-west-1", "eu-west-2", "eu-central-1",
      "ap-southeast-1", "ap-southeast-2", "ap-northeast-1"
    ];
    
    // Fetch actual month-to-date costs first to apply to resources
    this.logger.info('Fetching month-to-date costs from AWS Cost Explorer', {
      accountName: account.name
    });
    
    let actualCosts: Map<string, number>;
    let costBreakdowns: Map<string, any>;
    
    try {
      actualCosts = await withRetry(
        () => this.getResourceCosts(account),
        'getResourceCosts',
        { maxAttempts: 3 }
      );
      
      costBreakdowns = await withRetry(
        () => this.getResourceCostBreakdown(account),
        'getResourceCostBreakdown',
        { maxAttempts: 3 }
      );
    } catch (error) {
      this.logger.warn('Failed to fetch cost data, continuing without costs', error, {
        accountName: account.name
      });
      actualCosts = new Map();
      costBreakdowns = new Map();
    }
    
    try {
      this.logger.info('Starting AWS resource scan', {
        accountName: account.name,
        regions: regions.length,
        hasCostData: actualCosts.size > 0
      });
      
      // Sync S3 buckets (global service)
      const s3Resources = await this.syncS3Buckets(account, actualCosts);
      resources.push(...s3Resources);
      console.log(`Found ${s3Resources.length} S3 buckets`);

      // Sync regional resources across multiple regions
      for (const region of regions) {
        console.log(`Scanning region: ${region}`);
        
        try {
          // EC2 instances in this region
          const ec2Resources = await this.syncEC2InstancesInRegion(account, region, actualCosts, costBreakdowns);
          resources.push(...ec2Resources);
          console.log(`Found ${ec2Resources.length} EC2 instances in ${region}`);
        } catch (error) {
          console.error(`Error syncing EC2 instances: ${error.message}`);
          console.log(`Found 0 EC2 instances in ${region}`);
        }

        try {
          // RDS instances in this region
          const rdsResources = await this.syncRDSInstancesInRegion(account, region, actualCosts);
          resources.push(...rdsResources);
          console.log(`Found ${rdsResources.length} RDS instances in ${region}`);
        } catch (error) {
          console.error(`Error syncing RDS instances: ${error.message}`);
          console.log(`Found 0 RDS instances in ${region}`);
        }

        try {
          // EBS volumes in this region
          const ebsResources = await this.syncEBSVolumesInRegion(account, region, actualCosts);
          resources.push(...ebsResources);
          console.log(`Found ${ebsResources.length} EBS volumes in ${region}`);
        } catch (error) {
          console.error(`Error syncing EBS volumes: ${error.message}`);
          console.log(`Found 0 EBS volumes in ${region}`);
        }

        try {
          // Lambda functions in this region
          const lambdaResources = await this.syncLambdaFunctionsInRegion(account, region);
          resources.push(...lambdaResources);
          console.log(`Found ${lambdaResources.length} Lambda functions in ${region}`);
        } catch (error) {
          console.error(`Error scanning Lambda in ${region}:`, error.message);
        }

        try {
          // Load Balancers in this region
          const albResources = await this.syncLoadBalancersInRegion(account, region);
          resources.push(...albResources);
          console.log(`Found ${albResources.length} Load Balancers in ${region}`);
        } catch (error) {
          console.error(`Error scanning Load Balancers in ${region}:`, error.message);
        }

        try {
          // Auto Scaling Groups in this region
          const asgResources = await this.syncAutoScalingGroupsInRegion(account, region);
          resources.push(...asgResources);
          console.log(`Found ${asgResources.length} Auto Scaling Groups in ${region}`);
        } catch (error) {
          console.error(`Error scanning Auto Scaling Groups in ${region}:`, error.message);
        }

        try {
          // VPCs in this region
          const vpcResources = await this.syncVPCsInRegion(account, region);
          resources.push(...vpcResources);
          console.log(`Found ${vpcResources.length} VPCs in ${region}`);
        } catch (error) {
          console.error(`Error scanning VPCs in ${region}:`, error.message);
        }

        try {
          // Security Groups in this region
          const sgResources = await this.syncSecurityGroupsInRegion(account, region);
          resources.push(...sgResources);
          console.log(`Found ${sgResources.length} Security Groups in ${region}`);
        } catch (error) {
          console.error(`Error scanning Security Groups in ${region}:`, error.message);
        }

        try {
          // Subnets in this region
          const subnetResources = await this.syncSubnetsInRegion(account, region);
          resources.push(...subnetResources);
          console.log(`Found ${subnetResources.length} Subnets in ${region}`);
        } catch (error) {
          console.error(`Error scanning Subnets in ${region}:`, error.message);
        }

        try {
          // Network ACLs in this region
          const naclResources = await this.syncNetworkAclsInRegion(account, region);
          resources.push(...naclResources);
          console.log(`Found ${naclResources.length} Network ACLs in ${region}`);
        } catch (error) {
          console.error(`Error scanning Network ACLs in ${region}:`, error.message);
        }

        try {
          // Route Tables in this region
          const rtResources = await this.syncRouteTablesInRegion(account, region);
          resources.push(...rtResources);
          console.log(`Found ${rtResources.length} Route Tables in ${region}`);
        } catch (error) {
          console.error(`Error scanning Route Tables in ${region}:`, error.message);
        }

        try {
          // Internet Gateways in this region
          const igwResources = await this.syncInternetGatewaysInRegion(account, region);
          resources.push(...igwResources);
          console.log(`Found ${igwResources.length} Internet Gateways in ${region}`);
        } catch (error) {
          console.error(`Error scanning Internet Gateways in ${region}:`, error.message);
        }
      }

    } catch (error) {
      console.error(`Error syncing AWS resources for account ${account.name}:`, error);
      // Don't throw error - continue with partial results
    }

    console.log(`Total resources discovered: ${resources.length}`);
    return resources;
  }

  private async syncEC2InstancesInRegion(account: Account, region: string, actualCosts: Map<string, number>, costBreakdowns: Map<string, any>): Promise<Resource[]> {
    const ec2Client = await this.getClient(account, "ec2", region);
    const resources: Resource[] = [];

    try {
      const command = new DescribeInstancesCommand({});
      const response = await ec2Client.send(command);

      for (const reservation of response.Reservations || []) {
        for (const instance of reservation.Instances || []) {
          const name = instance.Tags?.find(tag => tag.Key === "Name")?.Value || instance.InstanceId || "Unknown";
          const resourceId = instance.InstanceId!;
          
          // Use only actual cost from AWS Cost Explorer
          const actualCost = actualCosts.get(resourceId);
          const monthlyCost = actualCost ? actualCost.toFixed(2) : null;
          
          // Get detailed cost breakdown
          const breakdown = costBreakdowns.get(resourceId);
          
          if (actualCost) {
            console.log(`💰 Actual cost for ${resourceId}: $${actualCost.toFixed(2)}`);
            if (breakdown) {
              console.log(`📊 Cost breakdown for ${resourceId}:`, {
                services: Object.keys(breakdown.services),
                usageTypes: Object.keys(breakdown.usageTypes)
              });
            }
          } else {
            console.log(`📊 No cost data available for ${resourceId} from AWS Cost Explorer`);
          }
          
          resources.push({
            accountId: account.id,
            resourceId: resourceId,
            name,
            type: "ec2-instance",
            provider: "aws",
            status: instance.State?.Name || "unknown",
            region: instance.Placement?.AvailabilityZone?.slice(0, -1),
            metadata: {
              instanceType: instance.InstanceType,
              imageId: instance.ImageId,
              launchTime: instance.LaunchTime,
              privateIpAddress: instance.PrivateIpAddress,
              publicIpAddress: instance.PublicIpAddress,
              tags: instance.Tags,
              state: instance.State?.Name,
              subnetId: instance.SubnetId,
              vpcId: instance.VpcId,
              securityGroups: instance.SecurityGroups,
              ebsOptimized: instance.EbsOptimized,
              placement: instance.Placement,
              architecture: instance.Architecture,
              virtualizationType: instance.VirtualizationType,
              cpuOptions: instance.CpuOptions,
              platformDetails: instance.PlatformDetails,
              // Use actual instance specs from AWS, not calculated values
              vcpus: instance.CpuOptions?.CoreCount || 'N/A',
              threads: instance.CpuOptions?.ThreadsPerCore || 'N/A',
              networkPerformance: instance.SriovNetSupport ? 'Enhanced Networking' : 'Standard',
              ebsOptimized: instance.EbsOptimized,
            },
            monthlyCost: monthlyCost,
            costBreakdown: breakdown || null,
            lastUpdated: new Date(),
          });
        }
      }
    } catch (error) {
      console.error("Error syncing EC2 instances:", error);
    }

    return resources;
  }

  private async syncRDSInstancesInRegion(account: Account, region: string, actualCosts: Map<string, number>): Promise<Resource[]> {
    const rdsClient = await this.getClient(account, "rds", region);
    const resources: Resource[] = [];

    try {
      const command = new DescribeDBInstancesCommand({});
      const response = await rdsClient.send(command);

      for (const dbInstance of response.DBInstances || []) {
        const resourceId = dbInstance.DBInstanceIdentifier!;
        
        // Use only actual cost from AWS Cost Explorer
        const actualCost = actualCosts.get(resourceId);
        const monthlyCost = actualCost ? actualCost.toFixed(2) : null;
        
        if (actualCost) {
          console.log(`💰 Actual cost for RDS ${resourceId}: $${actualCost.toFixed(2)}`);
        } else {
          console.log(`📊 No cost data available for RDS ${resourceId} from AWS Cost Explorer`);
        }
        
        resources.push({
          accountId: account.id,
          resourceId: resourceId,
          name: resourceId,
          type: "rds-instance",
          provider: "aws",
          status: dbInstance.DBInstanceStatus || "unknown",
          region: dbInstance.AvailabilityZone?.slice(0, -1),
          metadata: {
            engine: dbInstance.Engine,
            engineVersion: dbInstance.EngineVersion,
            instanceClass: dbInstance.DBInstanceClass,
            allocatedStorage: dbInstance.AllocatedStorage,
            endpoint: dbInstance.Endpoint?.Address,
            port: dbInstance.Endpoint?.Port,
          },
          monthlyCost: monthlyCost,
          lastUpdated: new Date(),
        });
      }
    } catch (error) {
      console.error("Error syncing RDS instances:", error);
    }

    return resources;
  }

  private async syncS3Buckets(account: Account, actualCosts: Map<string, number>): Promise<Resource[]> {
    const s3Client = await this.getClient(account, "s3");
    const resources: Resource[] = [];

    try {
      const command = new ListBucketsCommand({});
      const response = await s3Client.send(command);

      for (const bucket of response.Buckets || []) {
        const resourceId = bucket.Name!;
        
        // Use only actual cost from AWS Cost Explorer
        const actualCost = actualCosts.get(resourceId);
        const monthlyCost = actualCost ? actualCost.toFixed(2) : null;
        
        if (actualCost) {
          console.log(`💰 Actual cost for S3 ${resourceId}: $${actualCost.toFixed(2)}`);
        } else {
          console.log(`📊 No cost data available for S3 ${resourceId} from AWS Cost Explorer`);
        }
        
        resources.push({
          accountId: account.id,
          resourceId: resourceId,
          name: resourceId,
          type: "s3-bucket",
          provider: "aws",
          status: "active",
          region: "us-east-1", // Default region, would need GetBucketLocation for actual region
          metadata: {
            creationDate: bucket.CreationDate,
          },
          monthlyCost: monthlyCost,
          lastUpdated: new Date(),
        });
      }
    } catch (error) {
      console.error("Error syncing S3 buckets:", error);
    }

    return resources;
  }

  private async syncEBSVolumesInRegion(account: Account, region: string, actualCosts: Map<string, number>): Promise<Resource[]> {
    const ec2Client = await this.getClient(account, "ec2", region);
    const resources: Resource[] = [];

    try {
      const command = new DescribeVolumesCommand({});
      const response = await ec2Client.send(command);

      for (const volume of response.Volumes || []) {
        const name = volume.Tags?.find(tag => tag.Key === "Name")?.Value || volume.VolumeId || "Unknown";
        const resourceId = volume.VolumeId!;
        
        // Use only actual cost from AWS Cost Explorer
        const actualCost = actualCosts.get(resourceId);
        const monthlyCost = actualCost ? actualCost.toFixed(2) : null;
        
        if (actualCost) {
          console.log(`💰 Actual cost for EBS ${resourceId}: $${actualCost.toFixed(2)}`);
        } else {
          console.log(`📊 No cost data available for EBS ${resourceId} from AWS Cost Explorer`);
        }
        
        resources.push({
          accountId: account.id,
          resourceId: resourceId,
          name,
          type: "ebs-volume",
          provider: "aws",
          status: volume.State || "unknown",
          region: volume.AvailabilityZone?.slice(0, -1),
          metadata: {
            iops: volume.Iops, // Actual configured IOPS
            throughput: volume.Throughput, // Actual configured throughput in MiB/s
            size: volume.Size,
            encrypted: volume.Encrypted,
            volumeType: volume.VolumeType,
            attachments: volume.Attachments,
            tags: volume.Tags || [],
            availabilityZone: volume.AvailabilityZone,
            createTime: volume.CreateTime,
            state: volume.State,
          },
          monthlyCost: monthlyCost,
          lastUpdated: new Date(),
        });
      }
    } catch (error) {
      console.error("Error syncing EBS volumes:", error);
    }

    return resources;
  }

  private async syncLambdaFunctionsInRegion(account: Account, region: string): Promise<Resource[]> {
    const lambdaClient = await this.getClient(account, "lambda", region);
    const resources: Resource[] = [];

    try {
      const command = new ListFunctionsCommand({});
      const response = await lambdaClient.send(command);

      for (const func of response.Functions || []) {
        resources.push({
          accountId: account.id,
          resourceId: func.FunctionArn!,
          name: func.FunctionName!,
          type: "lambda-function",
          provider: "aws",
          status: func.State || "unknown",
          region: region,
          tags: {},
          metadata: {
            runtime: func.Runtime,
            handler: func.Handler,
            codeSize: func.CodeSize,
            timeout: func.Timeout,
            memorySize: func.MemorySize,
            lastModified: func.LastModified,
          },
          cost: "0.00"
        });
      }
    } catch (error) {
      console.error(`Error syncing Lambda functions in ${region}:`, error);
    }

    return resources;
  }

  private async syncLoadBalancersInRegion(account: Account, region: string): Promise<Resource[]> {
    const elbClient = await this.getClient(account, "elbv2", region);
    const resources: Resource[] = [];

    try {
      const command = new DescribeLoadBalancersCommand({});
      const response = await elbClient.send(command);

      for (const lb of response.LoadBalancers || []) {
        resources.push({
          accountId: account.id,
          resourceId: lb.LoadBalancerArn!,
          name: lb.LoadBalancerName!,
          type: "load-balancer",
          provider: "aws",
          status: lb.State?.Code || "unknown",
          region: region,
          tags: {},
          metadata: {
            type: lb.Type,
            scheme: lb.Scheme,
            ipAddressType: lb.IpAddressType,
            createdTime: lb.CreatedTime,
          },
          cost: "0.00"
        });
      }
    } catch (error) {
      console.error(`Error syncing Load Balancers in ${region}:`, error);
    }

    return resources;
  }

  private async syncAutoScalingGroupsInRegion(account: Account, region: string): Promise<Resource[]> {
    const asgClient = await this.getClient(account, "autoscaling", region);
    const resources: Resource[] = [];

    try {
      const command = new DescribeAutoScalingGroupsCommand({});
      const response = await asgClient.send(command);

      for (const asg of response.AutoScalingGroups || []) {
        resources.push({
          accountId: account.id,
          resourceId: asg.AutoScalingGroupARN!,
          name: asg.AutoScalingGroupName!,
          type: "autoscaling-group",
          provider: "aws",
          status: asg.ServiceLinkedRoleARN ? "active" : "unknown",
          region: region,
          tags: {},
          metadata: {
            minSize: asg.MinSize,
            maxSize: asg.MaxSize,
            desiredCapacity: asg.DesiredCapacity,
            launchTemplate: asg.LaunchTemplate?.LaunchTemplateName,
            createdTime: asg.CreatedTime,
          },
          cost: "0.00"
        });
      }
    } catch (error) {
      console.error(`Error syncing Auto Scaling Groups in ${region}:`, error);
    }

    return resources;
  }

  private async syncVPCsInRegion(account: Account, region: string): Promise<Resource[]> {
    const ec2Client = await this.getClient(account, "ec2", region);
    const resources: Resource[] = [];

    try {
      const command = new DescribeVpcsCommand({});
      const response = await ec2Client.send(command);

      for (const vpc of response.Vpcs || []) {
        const name = vpc.Tags?.find(tag => tag.Key === "Name")?.Value || vpc.VpcId || "Unknown";
        resources.push({
          accountId: account.id,
          resourceId: vpc.VpcId!,
          name: name,
          type: "vpc",
          provider: "aws",
          status: vpc.State || "unknown",
          region: region,
          tags: {},
          metadata: {
            cidrBlock: vpc.CidrBlock,
            isDefault: vpc.IsDefault,
            dhcpOptionsId: vpc.DhcpOptionsId,
          },
          cost: "0.00"
        });
      }
    } catch (error) {
      console.error(`Error syncing VPCs in ${region}:`, error);
    }

    return resources;
  }

  private async syncSecurityGroupsInRegion(account: Account, region: string): Promise<Resource[]> {
    const ec2Client = await this.getClient(account, "ec2", region);
    const resources: Resource[] = [];

    try {
      const command = new DescribeSecurityGroupsCommand({});
      const response = await ec2Client.send(command);

      for (const sg of response.SecurityGroups || []) {
        resources.push({
          accountId: account.id,
          resourceId: sg.GroupId!,
          name: sg.GroupName!,
          type: "security-group",
          provider: "aws",
          status: "active",
          region: region,
          tags: {},
          metadata: {
            description: sg.Description,
            vpcId: sg.VpcId,
            inboundRules: sg.IpPermissions?.length || 0,
            outboundRules: sg.IpPermissionsEgress?.length || 0,
          },
          cost: "0.00"
        });
      }
    } catch (error) {
      console.error(`Error syncing Security Groups in ${region}:`, error);
    }

    return resources;
  }

  private async syncSubnetsInRegion(account: Account, region: string): Promise<Resource[]> {
    const ec2Client = await this.getClient(account, "ec2", region);
    const resources: Resource[] = [];

    try {
      const command = new DescribeSubnetsCommand({});
      const response = await ec2Client.send(command);

      for (const subnet of response.Subnets || []) {
        const name = subnet.Tags?.find(tag => tag.Key === "Name")?.Value || subnet.SubnetId || "Unknown";
        resources.push({
          accountId: account.id,
          resourceId: subnet.SubnetId!,
          name: name,
          type: "subnet",
          provider: "aws",
          status: subnet.State || "unknown",
          region: region,
          tags: {},
          metadata: {
            vpcId: subnet.VpcId,
            cidrBlock: subnet.CidrBlock,
            availabilityZone: subnet.AvailabilityZone,
            mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch,
          },
          cost: "0.00"
        });
      }
    } catch (error) {
      console.error(`Error syncing Subnets in ${region}:`, error);
    }

    return resources;
  }

  private async syncNetworkAclsInRegion(account: Account, region: string): Promise<Resource[]> {
    const ec2Client = await this.getClient(account, "ec2", region);
    const resources: Resource[] = [];

    try {
      const command = new DescribeNetworkAclsCommand({});
      const response = await ec2Client.send(command);

      for (const nacl of response.NetworkAcls || []) {
        const name = nacl.Tags?.find(tag => tag.Key === "Name")?.Value || nacl.NetworkAclId || "Unknown";
        resources.push({
          accountId: account.id,
          resourceId: nacl.NetworkAclId!,
          name: name,
          type: "network-acl",
          provider: "aws",
          status: "active",
          region: region,
          tags: {},
          metadata: {
            vpcId: nacl.VpcId,
            isDefault: nacl.IsDefault,
            entryCount: nacl.Entries?.length || 0,
          },
          cost: "0.00"
        });
      }
    } catch (error) {
      console.error(`Error syncing Network ACLs in ${region}:`, error);
    }

    return resources;
  }

  private async syncRouteTablesInRegion(account: Account, region: string): Promise<Resource[]> {
    const ec2Client = await this.getClient(account, "ec2", region);
    const resources: Resource[] = [];

    try {
      const command = new DescribeRouteTablesCommand({});
      const response = await ec2Client.send(command);

      for (const rt of response.RouteTables || []) {
        const name = rt.Tags?.find(tag => tag.Key === "Name")?.Value || rt.RouteTableId || "Unknown";
        resources.push({
          accountId: account.id,
          resourceId: rt.RouteTableId!,
          name: name,
          type: "route-table",
          provider: "aws",
          status: "active",
          region: region,
          tags: {},
          metadata: {
            vpcId: rt.VpcId,
            routeCount: rt.Routes?.length || 0,
            associationCount: rt.Associations?.length || 0,
          },
          cost: "0.00"
        });
      }
    } catch (error) {
      console.error(`Error syncing Route Tables in ${region}:`, error);
    }

    return resources;
  }

  private async syncInternetGatewaysInRegion(account: Account, region: string): Promise<Resource[]> {
    const ec2Client = await this.getClient(account, "ec2", region);
    const resources: Resource[] = [];

    try {
      const command = new DescribeInternetGatewaysCommand({});
      const response = await ec2Client.send(command);

      for (const igw of response.InternetGateways || []) {
        const name = igw.Tags?.find(tag => tag.Key === "Name")?.Value || igw.InternetGatewayId || "Unknown";
        resources.push({
          accountId: account.id,
          resourceId: igw.InternetGatewayId!,
          name: name,
          type: "internet-gateway",
          provider: "aws",
          status: "active",
          region: region,
          tags: {},
          metadata: {
            attachmentCount: igw.Attachments?.length || 0,
            vpcIds: igw.Attachments?.map(a => a.VpcId) || [],
          },
          cost: "0.00"
        });
      }
    } catch (error) {
      console.error(`Error syncing Internet Gateways in ${region}:`, error);
    }

    return resources;
  }

  async getCostData(account: Account, startDate: Date, endDate: Date): Promise<Cost[]> {
    const costExplorerClient = await this.getClient(account, "cost-explorer");
    const costs: Cost[] = [];

    try {
      const command = new GetCostAndUsageCommand({
        TimePeriod: {
          Start: startDate.toISOString().split('T')[0],
          End: new Date().toISOString().split('T')[0], // Use today's date
        },
        Granularity: "DAILY",
        Metrics: ["BlendedCost"],
        GroupBy: [
          {
            Type: "DIMENSION",
            Key: "SERVICE",
          },
        ],
      });

      const response = await costExplorerClient.send(command);

      for (const result of response.ResultsByTime || []) {
        const date = new Date(result.TimePeriod?.Start || "");
        
        for (const group of result.Groups || []) {
          const service = group.Keys?.[0] || "Unknown";
          const amount = parseFloat(group.Metrics?.BlendedCost?.Amount || "0");

          costs.push({
            accountId: account.id,
            service,
            amount: amount.toString(),
            currency: "USD",
            period: "daily",
            date,
          });
        }
      }
    } catch (error) {
      console.error("Error fetching AWS cost data:", error);
    }

    return costs;
  }

  // Get actual accrued costs for current calendar month from AWS Cost Explorer
  async getResourceCosts(account: Account): Promise<Map<string, number>> {
    const costExplorerClient = await this.getClient(account, "cost-explorer");
    const resourceCosts = new Map<string, number>();

    try {
      // Get current calendar month accrued costs (month-to-date)
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const today = new Date();

      console.log(`🔍 Fetching accrued costs for current month: ${currentMonthStart.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}`);

      const command = new GetCostAndUsageCommand({
        TimePeriod: {
          Start: currentMonthStart.toISOString().split('T')[0],
          End: today.toISOString().split('T')[0],
        },
        Granularity: "DAILY", // Get daily data to sum up for month-to-date
        Metrics: ["UnblendedCost"], // Use UnblendedCost for actual costs without discounts
        GroupBy: [
          {
            Type: "DIMENSION",
            Key: "RESOURCE_ID",
          },
        ],
      });

      const response = await costExplorerClient.send(command);

      // Aggregate daily costs by resource for month-to-date total
      const resourceDailyCosts = new Map<string, number>();

      for (const result of response.ResultsByTime || []) {
        for (const group of result.Groups || []) {
          const resourceId = group.Keys?.[0];
          const dailyAmount = parseFloat(group.Metrics?.UnblendedCost?.Amount || "0");
          
          if (resourceId && dailyAmount > 0) {
            const currentTotal = resourceDailyCosts.get(resourceId) || 0;
            resourceDailyCosts.set(resourceId, currentTotal + dailyAmount);
          }
        }
      }

      // Store the month-to-date totals
      for (const [resourceId, monthToDateCost] of resourceDailyCosts) {
        resourceCosts.set(resourceId, monthToDateCost);
      }

      console.log(`💰 Fetched month-to-date accrued costs for ${resourceCosts.size} resources (${currentMonthStart.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]})`);
    } catch (error) {
      console.error("Error fetching resource-level costs from AWS:", error);
      console.error("Cost Explorer API may not be available or permissions insufficient");
    }

    return resourceCosts;
  }

  // Get detailed cost breakdown by service and usage type for resources
  async getResourceCostBreakdown(account: Account): Promise<Map<string, any>> {
    const costExplorerClient = await this.getClient(account, "cost-explorer");
    const resourceBreakdowns = new Map<string, any>();

    try {
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const today = new Date();

      console.log(`🔍 Fetching detailed cost breakdown for current month: ${currentMonthStart.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}`);

      // Get costs grouped by Resource ID and Service
      const serviceBreakdownCommand = new GetCostAndUsageCommand({
        TimePeriod: {
          Start: currentMonthStart.toISOString().split('T')[0],
          End: today.toISOString().split('T')[0],
        },
        Granularity: "DAILY",
        Metrics: ["UnblendedCost"],
        GroupBy: [
          {
            Type: "DIMENSION",
            Key: "RESOURCE_ID",
          },
          {
            Type: "DIMENSION",
            Key: "SERVICE",
          },
        ],
      });

      const serviceResponse = await costExplorerClient.send(serviceBreakdownCommand);

      // Aggregate costs by resource and service
      for (const result of serviceResponse.ResultsByTime || []) {
        for (const group of result.Groups || []) {
          const [resourceId, service] = group.Keys || [];
          const dailyAmount = parseFloat(group.Metrics?.UnblendedCost?.Amount || "0");
          
          if (resourceId && service && dailyAmount > 0) {
            if (!resourceBreakdowns.has(resourceId)) {
              resourceBreakdowns.set(resourceId, {
                totalCost: 0,
                services: {},
                usageTypes: {},
                dailyCosts: []
              });
            }
            
            const breakdown = resourceBreakdowns.get(resourceId);
            breakdown.totalCost += dailyAmount;
            breakdown.services[service] = (breakdown.services[service] || 0) + dailyAmount;
            
            // Store daily cost data
            breakdown.dailyCosts.push({
              date: result.TimePeriod?.Start,
              service,
              cost: dailyAmount
            });
          }
        }
      }

      // Get costs grouped by Resource ID and Usage Type
      const usageTypeCommand = new GetCostAndUsageCommand({
        TimePeriod: {
          Start: currentMonthStart.toISOString().split('T')[0],
          End: today.toISOString().split('T')[0],
        },
        Granularity: "DAILY",
        Metrics: ["UnblendedCost"],
        GroupBy: [
          {
            Type: "DIMENSION",
            Key: "RESOURCE_ID",
          },
          {
            Type: "DIMENSION",
            Key: "USAGE_TYPE",
          },
        ],
      });

      const usageResponse = await costExplorerClient.send(usageTypeCommand);

      // Add usage type breakdown
      for (const result of usageResponse.ResultsByTime || []) {
        for (const group of result.Groups || []) {
          const [resourceId, usageType] = group.Keys || [];
          const dailyAmount = parseFloat(group.Metrics?.UnblendedCost?.Amount || "0");
          
          if (resourceId && usageType && dailyAmount > 0 && resourceBreakdowns.has(resourceId)) {
            const breakdown = resourceBreakdowns.get(resourceId);
            breakdown.usageTypes[usageType] = (breakdown.usageTypes[usageType] || 0) + dailyAmount;
          }
        }
      }

      console.log(`💰 Fetched detailed cost breakdowns for ${resourceBreakdowns.size} resources`);
    } catch (error) {
      console.error("Error fetching detailed cost breakdown from AWS:", error);
      console.error("Cost Explorer API may not be available or permissions insufficient");
    }

    return resourceBreakdowns;
  }



  private getInstancePerformance(instanceType: string) {
    const performanceMap: Record<string, any> = {
      // General Purpose
      't3.nano': { vcpus: 2, memory: 0.5, networkPerformance: 'Up to 5 Gbps', ebsOptimizedByDefault: true },
      't3.micro': { vcpus: 2, memory: 1, networkPerformance: 'Up to 5 Gbps', ebsOptimizedByDefault: true },
      't3.small': { vcpus: 2, memory: 2, networkPerformance: 'Up to 5 Gbps', ebsOptimizedByDefault: true },
      't3.medium': { vcpus: 2, memory: 4, networkPerformance: 'Up to 5 Gbps', ebsOptimizedByDefault: true },
      't3.large': { vcpus: 2, memory: 8, networkPerformance: 'Up to 5 Gbps', ebsOptimizedByDefault: true },
      't3.xlarge': { vcpus: 4, memory: 16, networkPerformance: 'Up to 5 Gbps', ebsOptimizedByDefault: true },
      't3.2xlarge': { vcpus: 8, memory: 32, networkPerformance: 'Up to 5 Gbps', ebsOptimizedByDefault: true },
      
      // Compute Optimized
      'c5.large': { vcpus: 2, memory: 4, networkPerformance: 'Up to 10 Gbps', ebsOptimizedByDefault: true },
      'c5.xlarge': { vcpus: 4, memory: 8, networkPerformance: 'Up to 10 Gbps', ebsOptimizedByDefault: true },
      'c5.2xlarge': { vcpus: 8, memory: 16, networkPerformance: 'Up to 10 Gbps', ebsOptimizedByDefault: true },
      'c5.4xlarge': { vcpus: 16, memory: 32, networkPerformance: 'Up to 10 Gbps', ebsOptimizedByDefault: true },
      'c5.9xlarge': { vcpus: 36, memory: 72, networkPerformance: '10 Gbps', ebsOptimizedByDefault: true },
      'c5.18xlarge': { vcpus: 72, memory: 144, networkPerformance: '25 Gbps', ebsOptimizedByDefault: true },
      
      // Memory Optimized
      'r5.large': { vcpus: 2, memory: 16, networkPerformance: 'Up to 10 Gbps', ebsOptimizedByDefault: true },
      'r5.xlarge': { vcpus: 4, memory: 32, networkPerformance: 'Up to 10 Gbps', ebsOptimizedByDefault: true },
      'r5.2xlarge': { vcpus: 8, memory: 64, networkPerformance: 'Up to 10 Gbps', ebsOptimizedByDefault: true },
      'r5.4xlarge': { vcpus: 16, memory: 128, networkPerformance: 'Up to 10 Gbps', ebsOptimizedByDefault: true },
      
      // Storage Optimized
      'i3.large': { vcpus: 2, memory: 15.25, networkPerformance: 'Up to 10 Gbps', ebsOptimizedByDefault: true },
      'i3.xlarge': { vcpus: 4, memory: 30.5, networkPerformance: 'Up to 10 Gbps', ebsOptimizedByDefault: true },
      'i3.2xlarge': { vcpus: 8, memory: 61, networkPerformance: 'Up to 10 Gbps', ebsOptimizedByDefault: true },
    };
    
    return performanceMap[instanceType] || { 
      vcpus: 'Unknown', 
      memory: 'Unknown', 
      networkPerformance: 'Unknown',
      ebsOptimizedByDefault: false 
    };
  }

}
