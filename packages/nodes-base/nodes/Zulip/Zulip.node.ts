import {
	BINARY_ENCODING,
	IExecuteFunctions,
} from 'n8n-core';
import {
	IDataObject,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';
import {
	zulipApiRequest,
} from './GenericFunctions';
import {
	messageFields,
	messageOperations,
} from './MessageDescription';
import {
	IMessage,
} from './MessageInterface';
import { snakeCase } from 'change-case';
import {
	streamFields,
	streamOperations,
} from './StreamDescription';
import {
	userFields,
	userOperations,
} from './UserDescription';
import {
	IPrincipal,
	IStream,
} from './StreamInterface';
import { validateJSON } from './GenericFunctions';
import { IUser } from './UserInterface';

export class Zulip implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Zulip',
		name: 'zulip',
		icon: 'file:zulip.png',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Consume Zulip API',
		defaults: {
			name: 'Zulip',
			color: '#156742',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'zulipApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				options: [
					{
						name: 'Message',
						value: 'message',
					},
					{
						name: 'Stream',
						value: 'stream',
					},
					{
						name: 'User',
						value: 'user',
					},
				],
				default: 'message',
				description: 'Resource to consume.',
			},
			// MESSAGE
			...messageOperations,
			...messageFields,

			// STREAM
			...streamOperations,
			...streamFields,

			// USER
			...userOperations,
			...userFields,

		],
	};

	methods = {
		loadOptions: {
			// Get all the available streams to display them to user so that he can
			// select them easily
			async getStreams(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const returnData: INodePropertyOptions[] = [];
				const { streams } = await zulipApiRequest.call(this, 'GET', '/streams');
				for (const stream of streams) {
					const streamName = stream.name;
					const streamId = stream.stream_id;
					returnData.push({
						name: streamName,
						value: streamId,
					});
				}
				return returnData;
			},
			// Get all the available topics to display them to user so that he can
			// select them easily
			async getTopics(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const streamId = this.getCurrentNodeParameter('stream') as string;
				const returnData: INodePropertyOptions[] = [];
				const { topics } = await zulipApiRequest.call(this, 'GET', `/users/me/${streamId}/topics`);
				for (const topic of topics) {
					const topicName = topic.name;
					const topicId = topic.name;
					returnData.push({
						name: topicName,
						value: topicId,
					});
				}
				return returnData;
			},
			// Get all the available users to display them to user so that he can
			// select them easily
			async getUsers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const returnData: INodePropertyOptions[] = [];
				const { members } = await zulipApiRequest.call(this, 'GET', '/users');
				for (const member of members) {
					const memberName = member.full_name;
					const memberId = member.email;
					returnData.push({
						name: memberName,
						value: memberId,
					});
				}
				return returnData;
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: IDataObject[] = [];
		const length = items.length as unknown as number;
		let responseData;
		const qs: IDataObject = {};
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		for (let i = 0; i < length; i++) {
			if (resource === 'message') {
				//https://zulipchat.com/api/send-message
				if (operation === 'sendPrivate') {
					const to = (this.getNodeParameter('to', i) as string[]).join(',');
					const content = this.getNodeParameter('content', i) as string;
					const body: IMessage = {
						type: 'private',
						to,
						content,
					};
					responseData = await zulipApiRequest.call(this, 'POST', '/messages', body);
				}
				//https://zulipchat.com/api/send-message
				if (operation === 'sendStream') {
					const stream = this.getNodeParameter('stream', i) as string;
					const topic = this.getNodeParameter('topic', i);
					const content = this.getNodeParameter('content', i) as string;
					const body: IMessage = {
						type: 'stream',
						to: stream,
						topic,
						content,
					};
					responseData = await zulipApiRequest.call(this, 'POST', '/messages', body);
				}
				//https://zulipchat.com/api/update-message
				if (operation === 'update') {
					const messageId = this.getNodeParameter('messageId', i) as string;
					const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;
					const body: IMessage = {};
					if (updateFields.content) {
						body.content = updateFields.content as string;
					}
					if (updateFields.propagateMode) {
						body.propagat_mode = snakeCase(updateFields.propagateMode as string);
					}
					if (updateFields.topic) {
						body.topic = updateFields.topic as string;
					}
					responseData = await zulipApiRequest.call(this, 'PATCH', `/messages/${messageId}`, body);
				}
				//https://zulipchat.com/api/get-raw-message
				if (operation === 'get') {
					const messageId = this.getNodeParameter('messageId', i) as string;
					responseData = await zulipApiRequest.call(this, 'GET', `/messages/${messageId}`);
				}
				//https://zulipchat.com/api/delete-message
				if (operation === 'delete') {
					const messageId = this.getNodeParameter('messageId', i) as string;
					responseData = await zulipApiRequest.call(this, 'DELETE', `/messages/${messageId}`);
				}
				//https://zulipchat.com/api/upload-file
				if (operation === 'updateFile') {
					const credentials = this.getCredentials('zulipApi');
					const binaryProperty = this.getNodeParameter('dataBinaryProperty', i) as string;
					if (items[i].binary === undefined) {
						throw new NodeOperationError(this.getNode(), 'No binary data exists on item!');
					}
					//@ts-ignore
					if (items[i].binary[binaryProperty] === undefined) {
						throw new NodeOperationError(this.getNode(), `No binary data property "${binaryProperty}" does not exists on item!`);
					}
					const formData = {
						file: {
							//@ts-ignore
							value: Buffer.from(items[i].binary[binaryProperty].data, BINARY_ENCODING),
							options: {
								//@ts-ignore
								filename: items[i].binary[binaryProperty].fileName,
								//@ts-ignore
								contentType: items[i].binary[binaryProperty].mimeType,
							},
						},
					};
					responseData = await zulipApiRequest.call(this, 'POST', '/user_uploads', {}, {}, undefined, { formData });
					responseData.uri = `${credentials!.url}${responseData.uri}`;
				}
			}

			if (resource === 'stream') {
				const body: IStream = {};

				if (operation === 'getAll') {
					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

					if (additionalFields.includePublic) {
						body.include_public = additionalFields.includePublic as boolean;
					}
					if (additionalFields.includeSubscribed) {
						body.include_subscribed = additionalFields.includeSubscribed as boolean;
					}
					if (additionalFields.includeAllActive) {
						body.include_all_active = additionalFields.includeAllActive as boolean;
					}
					if (additionalFields.includeDefault) {
						body.include_default = additionalFields.includeDefault as boolean;
					}
					if (additionalFields.includeOwnersubscribed) {
						body.include_owner_subscribed = additionalFields.includeOwnersubscribed as boolean;
					}

					responseData = await zulipApiRequest.call(this, 'GET', `/streams`, body);
					responseData = responseData.streams;
				}

				if (operation === 'getSubscribed') {
					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

					if (additionalFields.includeSubscribers) {
						body.include_subscribers = additionalFields.includeSubscribers as boolean;
					}

					responseData = await zulipApiRequest.call(this, 'GET', `/users/me/subscriptions`, body);
					responseData = responseData.subscriptions;
				}

				if (operation === 'create') {
					const jsonParameters = this.getNodeParameter('jsonParameters', i);
					const subscriptions = this.getNodeParameter('subscriptions', i) as IDataObject;

					body.subscriptions = JSON.stringify(subscriptions.properties);

					if (jsonParameters) {
						const additionalFieldsJson = this.getNodeParameter('additionalFieldsJson', i) as string;

						if (additionalFieldsJson !== '') {
							if (validateJSON(additionalFieldsJson) !== undefined) {
								Object.assign(body, JSON.parse(additionalFieldsJson));
							} else {
								throw new NodeOperationError(this.getNode(), 'Additional fields must be a valid JSON');
							}
						}

					} else {
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

						const subscriptions = this.getNodeParameter('subscriptions', i) as IDataObject;
						body.subscriptions = JSON.stringify(subscriptions.properties);

						if (additionalFields.inviteOnly) {
							body.invite_only = additionalFields.inviteOnly as boolean;
						}
						if (additionalFields.principals) {
							const principals: string[] = [];
							//@ts-ignore
							additionalFields.principals.properties.map((principal: IPrincipal) => {
								principals.push(principal.email);
							});
							body.principals = JSON.stringify(principals);
						}
						if (additionalFields.authorizationErrorsFatal) {
							body.authorization_errors_fatal = additionalFields.authorizationErrorsFatal as boolean;
						}
						if (additionalFields.historyPublicToSubscribers) {
							body.history_public_to_subscribers = additionalFields.historyPublicToSubscribers as boolean;
						}
						if (additionalFields.streamPostPolicy) {
							body.stream_post_policy = additionalFields.streamPostPolicy as number;
						}
						if (additionalFields.announce) {
							body.announce = additionalFields.announce as boolean;
						}
					}

					responseData = await zulipApiRequest.call(this, 'POST', `/users/me/subscriptions`, body);
				}

				if (operation === 'delete') {
					const streamId = this.getNodeParameter('streamId', i) as string;

					responseData = await zulipApiRequest.call(this, 'DELETE', `/streams/${streamId}`, {});
				}

				if (operation === 'update') {
					const streamId = this.getNodeParameter('streamId', i) as string;

					const jsonParameters = this.getNodeParameter('jsonParameters', i);

					if (jsonParameters) {
						const additionalFieldsJson = this.getNodeParameter('additionalFieldsJson', i) as string;

						if (additionalFieldsJson !== '') {

							if (validateJSON(additionalFieldsJson) !== undefined) {

								Object.assign(body, JSON.parse(additionalFieldsJson));

							} else {
								throw new NodeOperationError(this.getNode(), 'Additional fields must be a valid JSON');
							}
						}

					} else {

						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

						if (additionalFields.description) {
							body.description = JSON.stringify(additionalFields.description as string);
						}
						if (additionalFields.newName) {
							body.new_name = JSON.stringify(additionalFields.newName as string);
						}
						if (additionalFields.isPrivate) {
							body.is_private = additionalFields.isPrivate as boolean;
						}
						if (additionalFields.isAnnouncementOnly) {
							body.is_announcement_only = additionalFields.isAnnouncementOnly as boolean;
						}
						if (additionalFields.streamPostPolicy) {
							body.stream_post_policy = additionalFields.streamPostPolicy as number;
						}
						if (additionalFields.historyPublicToSubscribers) {
							body.history_public_to_subscribers = additionalFields.historyPublicToSubscribers as boolean;
						}

						responseData = await zulipApiRequest.call(this, 'PATCH', `/streams/${streamId}`, body);
					}

				}
			}

			if (resource === 'user') {
				const body: IUser = {};

				if (operation === 'get') {
					const userId = this.getNodeParameter('userId', i) as string;
					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

					if (additionalFields.clientGravatar) {
						body.client_gravatar = additionalFields.client_gravatar as boolean;
					}
					if (additionalFields.includeCustomProfileFields) {
						body.include_custom_profile_fields = additionalFields.includeCustomProfileFields as boolean;
					}

					responseData = await zulipApiRequest.call(this, 'GET', `/users/${userId}`, body);

				}

				if (operation === 'getAll') {
					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

					if (additionalFields.clientGravatar) {
						body.client_gravatar = additionalFields.client_gravatar as boolean;
					}
					if (additionalFields.includeCustomProfileFields) {
						body.include_custom_profile_fields = additionalFields.includeCustomProfileFields as boolean;
					}

					responseData = await zulipApiRequest.call(this, 'GET', `/users`, body);
					responseData = responseData.members;
				}

				if (operation === 'create') {
					body.email = this.getNodeParameter('email', i) as string;
					body.password = this.getNodeParameter('password', i);
					body.full_name = this.getNodeParameter('fullName', i) as string;
					body.short_name = this.getNodeParameter('shortName', i) as string;

					responseData = await zulipApiRequest.call(this, 'POST', `/users`, body);
				}

				if (operation === 'update') {
					const userId = this.getNodeParameter('userId', i) as string;
					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

					if (additionalFields.fullName) {
						body.full_name = JSON.stringify(additionalFields.fullName as string);
					}
					if (additionalFields.isAdmin) {
						body.is_admin = additionalFields.isAdmin as boolean;
					}
					if (additionalFields.isGuest) {
						body.is_guest = additionalFields.isGuest as boolean;
					}
					if (additionalFields.profileData) {
						//@ts-ignore
						body.profile_data = additionalFields.profileData.properties as [{}];
					}

					responseData = await zulipApiRequest.call(this, 'PATCH', `/users/${userId}`, body);
				}

				if (operation === 'deactivate') {
					const userId = this.getNodeParameter('userId', i) as string;

					responseData = await zulipApiRequest.call(this, 'DELETE', `/users/${userId}`, body);
				}
			}

			if (Array.isArray(responseData)) {
				returnData.push.apply(returnData, responseData as IDataObject[]);
			} else {
				returnData.push(responseData as IDataObject);
			}
		}
		return [this.helpers.returnJsonArray(returnData)];
	}
}
