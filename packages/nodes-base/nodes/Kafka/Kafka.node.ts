import {
	CompressionTypes,
	Kafka as apacheKafka,
	KafkaConfig,
	SASLOptions,
	TopicMessages,
} from 'kafkajs';

import {
	IExecuteFunctions,
} from 'n8n-core';

import {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

export class Kafka implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kafka',
		name: 'kafka',
		icon: 'file:kafka.svg',
		group: ['transform'],
		version: 1,
		description: 'Sends messages to a Kafka topic',
		defaults: {
			name: 'Kafka',
			color: '#000000',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'kafka',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Topic',
				name: 'topic',
				type: 'string',
				default: '',
				placeholder: 'topic-name',
				description: 'Name of the queue of topic to publish to.',
			},
			{
				displayName: 'Send Input Data',
				name: 'sendInputData',
				type: 'boolean',
				default: true,
				description: 'Send the the data the node receives as JSON to Kafka.',
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				displayOptions: {
					show: {
						sendInputData: [
							false,
						],
					},
				},
				default: '',
				description: 'The message to be sent.',
			},
			{
				displayName: 'JSON Parameters',
				name: 'jsonParameters',
				type: 'boolean',
				default: false,
			},
			{
				displayName: 'Headers',
				name: 'headersUi',
				placeholder: 'Add Header',
				type: 'fixedCollection',
				displayOptions: {
					show: {
						jsonParameters: [
							false,
						],
					},
				},
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				options: [
					{
						name: 'headerValues',
						displayName: 'Header',
						values: [
							{
								displayName: 'Key',
								name: 'key',
								type: 'string',
								default: '',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'Headers (JSON)',
				name: 'headerParametersJson',
				type: 'json',
				displayOptions: {
					show: {
						jsonParameters: [
							true,
						],
					},
				},
				default: '',
				description: 'Header parameters as JSON (flat object).',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				default: {},
				placeholder: 'Add Option',
				options: [
					{
						displayName: 'Acks',
						name: 'acks',
						type: 'boolean',
						default: false,
						description: 'Whether or not producer must wait for acknowledgement from all replicas.',
					},
					{
						displayName: 'Compression',
						name: 'compression',
						type: 'boolean',
						default: false,
						description: 'Send the data in a compressed format using the GZIP codec.',
					},
					{
						displayName: 'Timeout',
						name: 'timeout',
						type: 'number',
						default: 30000,
						description: 'The time to await a response in ms.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();

		const length = items.length as unknown as number;

		const topicMessages: TopicMessages[] = [];

		let responseData: IDataObject[];

		const options = this.getNodeParameter('options', 0) as IDataObject;
		const sendInputData = this.getNodeParameter('sendInputData', 0) as boolean;

		const timeout = options.timeout as number;

		let compression = CompressionTypes.None;

		const acks = (options.acks === true) ? 1 : 0;

		if (options.compression === true) {
			compression = CompressionTypes.GZIP;
		}

		const credentials = this.getCredentials('kafka') as IDataObject;

		const brokers = (credentials.brokers as string || '').split(',').map(item => item.trim()) as string[];

		const clientId = credentials.clientId as string;

		const ssl = credentials.ssl as boolean;

		const config: KafkaConfig = {
			clientId,
			brokers,
			ssl,
		};

		if (credentials.authentication === true) {
			if(!(credentials.username && credentials.password)) {
				throw new NodeOperationError(this.getNode(), 'Username and password are required for authentication');
			}
			config.sasl = {
				username: credentials.username as string,
				password: credentials.password as string,
				mechanism: credentials.saslMechanism as string,
			} as SASLOptions;
		}

		const kafka = new apacheKafka(config);

		const producer = kafka.producer();

		await producer.connect();

		let message: string;

		for (let i = 0; i < length; i++) {
			if (sendInputData === true) {
				message = JSON.stringify(items[i].json);
			} else {
				message = this.getNodeParameter('message', i);
			}

			const topic = this.getNodeParameter('topic', i);

			const jsonParameters = this.getNodeParameter('jsonParameters', i);

			let headers;

			if (jsonParameters === true) {
				headers = this.getNodeParameter('headerParametersJson', i) as string;
				try {
					headers = JSON.parse(headers);
				} catch (exception) {
					throw new NodeOperationError(this.getNode(), 'Headers must be a valid json');
				}
			} else {
				const values = (this.getNodeParameter('headersUi', i) as IDataObject).headerValues as IDataObject[];
				headers = {};
				if (values !== undefined) {
					for (const value of values) {
						//@ts-ignore
						headers[value.key] = value.value;
					}
				}
			}

			topicMessages.push(
				{
					topic,
					messages: [{
						value: message,
						headers,
					}],
				});
		}

		responseData = await producer.sendBatch(
			{
				topicMessages,
				timeout,
				compression,
				acks,
			},
		);

		if (responseData.length === 0) {
			responseData.push({
				success: true,
			});
		}

		await producer.disconnect();

		return [this.helpers.returnJsonArray(responseData)];
	}
}
