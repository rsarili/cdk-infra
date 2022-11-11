import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as rds from 'aws-cdk-lib/aws-rds'


export class CdkInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'cdk-test-vpc', {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name:'public',
          subnetType: ec2.SubnetType.PUBLIC
        },
        {
          cidrMask: 24,
          name:'application',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        },
        {
          cidrMask: 24,
          name:'db',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }
      ],
      maxAzs: 3
    });

    const webserverSG = new ec2.SecurityGroup(this, 'cdk-webserver-sg',{
      vpc,
      allowAllOutbound: true
    })
    webserverSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'allow SSH access from anywhere',
    );

    webserverSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'allow HTTP traffic from anywhere',
    );

    webserverSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'allow HTTPS traffic from anywhere',
    );

    const role = new iam.Role(this, 'cdk-ec2role', {
       assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
     });

     const userData = ec2.UserData.forLinux();
     userData.addCommands(
       'sudo su',
       'yum install -y httpd',
       'systemctl start httpd',
       'systemctl enable httpd',
       'echo "<h1>Hello World from $(hostname -f)</h1>" > /var/www/html/index.html',
     );

   const asg = new autoscaling.AutoScalingGroup(this, 'cdk-ASG', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE2, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage({generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2}),
      securityGroup: webserverSG,
      minCapacity: 2,
      maxCapacity: 5,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      },
      role,
      keyName: 'cdk-infra',
      userData
    })

    const alb = new elbv2.ApplicationLoadBalancer(this, 'cdk-elb', {
      vpc,
      internetFacing:true
    })

    const listener = alb.addListener('cdk-listener', {
      port: 80  
    })

    listener.addTargets('default-target', {
      port:80,
      targets: [asg],
      healthCheck: {
        path: '/',
        unhealthyThresholdCount: 2,
        healthyThresholdCount: 5,
        interval: cdk.Duration.seconds(30),
      },
    })

    listener.addAction('/static', {
      priority: 5,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/static'])],
      action: elbv2.ListenerAction.fixedResponse(200, {
        contentType: 'text/html',
        messageBody: '<h1>Static ALB Response</h1>',
      }),
    });

    asg.scaleOnRequestCount('requests-per-minute', {
      targetRequestsPerMinute: 60,
    });

    // 👇 add scaling policy for the Auto Scaling Group
    asg.scaleOnCpuUtilization('cpu-util-scaling', {
      targetUtilizationPercent: 75,
    });

    // 👇 add the ALB DNS as an Output
    new cdk.CfnOutput(this, 'albDNS', {
      value: alb.loadBalancerDnsName,
    });

    const rdsSG = new ec2.SecurityGroup(this, 'cdk-rds-sg',{
      vpc,
    })
    rdsSG.addIngressRule(
      webserverSG,
      ec2.Port.tcp(5432),
      'allow webservers',
    );

    const dbInstance = new rds.DatabaseInstance(this, 'db-instance', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_14_4,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.MICRO,
      ),
      credentials: rds.Credentials.fromGeneratedSecret('postgres'),
      multiAz: false,
      allocatedStorage: 100,
      maxAllocatedStorage: 105,
      allowMajorVersionUpgrade: false,
      autoMinorVersionUpgrade: true,
      backupRetention: cdk.Duration.days(0),
      deleteAutomatedBackups: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
      databaseName: 'todosdb',
      publiclyAccessible: false,
      securityGroups: [rdsSG]
    });


    new cdk.CfnOutput(this, 'dbEndpoint', {
      value: dbInstance.instanceEndpoint.hostname,
    });

    new cdk.CfnOutput(this, 'secretName', {
      value: dbInstance.secret?.secretName!,
    });
  }
}
